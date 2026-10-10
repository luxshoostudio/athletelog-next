/* The Livy inbox file: data/livy-inbox-<uid>.json
 *
 * Append-only. The MCP server and POST /api/livy/inbox write it; the signed-in app reads it,
 * copies new entries into its own state, and acks the ids it kept or had already. A write never
 * opens the profile document, so it cannot overwrite a workout the app is pushing at the same time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './durable.js'
import { validateLivyFood, validateLivyWorkout } from './livy.js'

const MAX_ITEMS = 200
const MAX_BATCH = 20

const safeUid = uid => String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '')
export const inboxPath = (dataDir, uid) => path.join(dataDir, 'livy-inbox-' + safeUid(uid) + '.json')

function readFile(dataDir, uid) {
  try {
    const raw = JSON.parse(fs.readFileSync(inboxPath(dataDir, uid), 'utf8'))
    const items = Array.isArray(raw?.items) ? raw.items.filter(x => x && typeof x === 'object' && typeof x.id === 'string') : []
    return { items }
  } catch (e) {
    if (e.code === 'ENOENT') return { items: [] }
    const err = new Error('inbox unreadable')
    err.code = 'EIO'
    throw err
  }
}

/** Pending items. An unreadable file is empty here: a profile pull must still answer. */
export function listInbox(dataDir, uid) {
  try { return readFile(dataDir, uid).items } catch { return [] }
}

export function countInbox(dataDir, uid) {
  return listInbox(dataDir, uid).length
}

/**
 * Turn one agent payload into an inbox item. `input` is either `{ kind, id, ...fields }` or
 * `{ kind, id, entry }`. Food and workout only.
 */
export function prepareLivyItem(input, now = Date.now(), resolveExercise) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid item' }
  const kind = input.kind
  const raw = input.entry && typeof input.entry === 'object' && !Array.isArray(input.entry)
    ? { ...input.entry, id: input.entry.id || input.id }
    : input
  if (input.id && raw.id && input.id !== raw.id) return { ok: false, error: 'id does not match entry.id' }
  const v = kind === 'food'
    ? validateLivyFood(raw, now)
    : kind === 'workout'
      ? validateLivyWorkout(raw, now, resolveExercise)
      : { ok: false, error: 'kind must be food or workout' }
  if (!v.ok) return v
  return { ok: true, item: { id: v.entry.id, kind, entry: v.entry, at: now } }
}

/** Validate and append. Duplicate ids are reported and not written twice. */
export function appendInbox(dataDir, uid, inputs, now = Date.now(), resolveExercise) {
  const list = Array.isArray(inputs) ? inputs : [inputs]
  if (list.length > MAX_BATCH) return { ok: false, error: `at most ${MAX_BATCH} entries at once`, added: [], skipped: [] }
  let cur
  try { cur = readFile(dataDir, uid) }
  catch { return { ok: false, error: 'inbox unreadable', added: [], skipped: [] } }
  const have = new Set(cur.items.map(i => i.id))
  const added = []
  const skipped = []
  for (const input of list) {
    const v = prepareLivyItem(input, now, resolveExercise)
    if (!v.ok) { skipped.push({ id: input?.id ?? null, reason: v.error }); continue }
    if (have.has(v.item.id)) { skipped.push({ id: v.item.id, reason: 'duplicate' }); continue }
    if (cur.items.length >= MAX_ITEMS) { skipped.push({ id: v.item.id, reason: 'inbox is full' }); continue }
    cur.items.push(v.item)
    have.add(v.item.id)
    added.push(v.item)
  }
  if (added.length) atomicWrite(inboxPath(dataDir, uid), JSON.stringify({ items: cur.items }), 0o600)
  return { ok: true, added, skipped }
}

/** Drop acked ids. Ids the file does not have are ignored. */
export function ackInbox(dataDir, uid, ids) {
  const drop = new Set((Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string'))
  if (!drop.size) return { ok: true, removed: [] }
  let cur
  try { cur = readFile(dataDir, uid) }
  catch { return { ok: false, error: 'inbox unreadable', removed: [] } }
  const removed = []
  const next = []
  for (const item of cur.items) {
    if (drop.has(item.id)) removed.push(item.id)
    else next.push(item)
  }
  if (removed.length) {
    if (next.length) atomicWrite(inboxPath(dataDir, uid), JSON.stringify({ items: next }), 0o600)
    else { try { fs.unlinkSync(inboxPath(dataDir, uid)) } catch { /* already gone */ } }
  }
  return { ok: true, removed }
}

/** POST /api/livy/inbox body: one entry, or `{ items: [...] }`. */
export function inputsFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  if (Array.isArray(body.items)) return body.items
  if (body.kind) return [body]
  return null
}
