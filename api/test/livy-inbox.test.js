import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendInbox, ackInbox, listInbox } from '../livy-inbox.js';
import { boundPort } from './helpers.mjs';

const API = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('append is idempotent, refuses a bad entry, and ack drops only named ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livy-file-'));
  const food = { kind: 'food', id: 'livy-oats', name: 'oats', amount: 40, unit: 'g', calories: 150, protein: 5, date: '2026-10-10', time: '08:00' };
  const first = appendInbox(dir, 'user_1', food, 1000);
  assert.equal(first.ok, true);
  assert.equal(first.added.length, 1);
  assert.equal(first.added[0].entry.source, 'livy');
  const second = appendInbox(dir, 'user_1', food, 1000);
  assert.equal(second.added.length, 0);
  assert.equal(second.skipped[0].reason, 'duplicate');
  assert.equal(listInbox(dir, 'user_1').length, 1);
  const bad = appendInbox(dir, 'user_1', { kind: 'food', id: 'x', name: 'x', calories: -1, date: '2026-10-10' }, 1000);
  assert.equal(bad.added.length, 0);
  assert.match(bad.skipped[0].reason, /calories/);
  const workout = appendInbox(dir, 'user_1', {
    kind: 'workout', id: 'livy-push', date: '2026-10-10', name: 'Push',
    exercises: [{ exercise_id: '0033', sets: [{ weight: 40, reps: 8 }] }],
  }, 1000);
  assert.equal(workout.added.length, 1);
  assert.equal(workout.added[0].entry.source, 'livy');
  assert.equal(workout.added[0].entry.entries[0].id, '0033');
  const acked = ackInbox(dir, 'user_1', ['livy-oats']);
  assert.deepEqual(acked.removed, ['livy-oats']);
  assert.deepEqual(listInbox(dir, 'user_1').map(i => i.id), ['livy-push']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('POST /api/livy/inbox needs a session, queues one food entry, and does not write it twice', async t => {
  const SECRET = 'test-secret-livy-inbox';
  const uid = 'u_livy_1';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-livy-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'L', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const base = `http://127.0.0.1:${port}`;
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  const headers = {
    cookie: `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`,
    origin: 'http://localhost:8080',
    'content-type': 'application/json',
  };
  const body = JSON.stringify({ kind: 'food', id: 'livy-eggs', name: 'eggs', amount: 2, unit: 'egg', calories: 140, protein: 12, date: '2026-10-10', time: '08:10' });

  assert.equal((await fetch(`${base}/api/livy/inbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
  const put = await fetch(`${base}/api/livy/inbox`, { method: 'POST', headers, body });
  assert.equal(put.status, 200, log);
  const queued = await put.json();
  assert.equal(queued.added[0].id, 'livy-eggs');
  assert.equal(queued.added[0].source, 'livy');
  const again = await (await fetch(`${base}/api/livy/inbox`, { method: 'POST', headers, body })).json();
  assert.equal(again.added.length, 0);
  assert.equal(again.skipped[0].reason, 'duplicate');
  const rev = await (await fetch(`${base}/api/data/rev`, { headers })).json();
  assert.equal(rev.livy, 1);
  assert.equal(rev.rev, 0);
  const data = await (await fetch(`${base}/api/data`, { headers })).json();
  assert.equal(data.inbox.length, 1);
  assert.equal(data.state, null);
  const bad = await fetch(`${base}/api/livy/inbox`, {
    method: 'POST', headers,
    body: JSON.stringify({ kind: 'food', id: 'nope', name: 'x', calories: -3, date: '2026-10-10' }),
  });
  assert.equal(bad.status, 400);
});
