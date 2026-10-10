/* Livy tools: read recent food, and append food or workout entries to the inbox.
   Appending never opens the profile document. */
import { z } from 'zod'
import { getState, getUser, dataDir } from './state.js'
import { appendInbox, listInbox } from '../../api/livy-inbox.js'
import { EXIDX, normalizeStr } from '../../frontend/src/lib/exercises.js'

const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const todayIso = () => localIso(new Date())

function shiftDays(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return localIso(d)
}

export function resolveExercise(S, row) {
  const custom = Array.isArray(S?.customEx) ? S.customEx : []
  const id = row?.exercise_id || (row?.exercise_name ? null : row?.id)
  if (id) {
    const hit = custom.find(e => e && e.id === id) || EXIDX[id]
    return hit ? { id: hit.id } : null
  }
  const q = normalizeStr(row?.exercise_name || '')
  if (!q) return null
  const hits = []
  const seen = new Set()
  for (const e of [...custom, ...Object.values(EXIDX)]) {
    if (!e?.id || seen.has(e.id)) continue
    if (normalizeStr(e.n) === q) { hits.push(e); seen.add(e.id) }
  }
  return hits.length === 1 ? { id: hits[0].id } : null
}

function inboxItems() {
  try { return listInbox(dataDir(), getUser().id) } catch { return [] }
}

function range({ from, to, days }) {
  const hi = to || todayIso()
  const lo = from || (days ? shiftDays(hi, -(days - 1)) : null)
  return { from: lo, to: hi }
}

function inRange(date, { from, to }) {
  if (!date) return false
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

export const listFoodLogs = {
  name: 'list_food_logs',
  description: 'List food entries in a recent window (default the last 7 days, including today), newest first. Each entry uses the same fields the food log stores: id, name, amount, unit, calories, protein, fat, carbs, fiber, date, time, source. Pending Livy inbox entries that are not in the log yet are included with pending: true so a coach sees what it just added.',
  schema: {
    days: z.number().int().min(1).max(90).optional().describe('How many days back from `to` (or today), including that day. Defaults to 7. Ignored when `from` is set.'),
    from: isoDate().optional().describe('Inclusive start date YYYY-MM-DD.'),
    to: isoDate().optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.'),
  },
  handler: ({ days, from, to } = {}) => {
    const S = getState()
    const window = range({ from, to, days: from ? undefined : (days || 7) })
    if (!S) {
      return {
        error: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
        unit: 'kg', from: window.from, to: window.to, entries: [],
      }
    }
    const logged = (S.foodEntries || []).filter(e => e && inRange(e.date, window))
    const have = new Set(logged.map(e => e.id))
    const pending = inboxItems().filter(i => i.kind === 'food' && i.entry && !have.has(i.entry.id) && inRange(i.entry.date, window))
    const entries = [
      ...logged.map(e => ({ ...publicFood(e), pending: false })),
      ...pending.map(i => ({ ...publicFood(i.entry), pending: true })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.time).localeCompare(String(a.time)))
    const totals = entries.reduce((out, e) => {
      for (const k of ['calories', 'protein', 'fiber', 'fat', 'carbs']) out[k] += Number(e[k]) || 0
      return out
    }, { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0 })
    return {
      from: window.from, to: window.to, count: entries.length,
      pending_count: pending.length, totals, entries,
    }
  },
}

function publicFood(e) {
  return {
    id: e.id, name: e.name, amount: e.amount ?? e.qty ?? null, unit: e.unit || null,
    calories: Number(e.calories) || 0, protein: Number(e.protein) || 0,
    fat: Number(e.fat) || 0, carbs: Number(e.carbs) || 0, fiber: Number(e.fiber) || 0,
    date: e.date || null, time: e.time || null, source: e.source || null,
    ...(e.barcode ? { barcode: e.barcode } : {}),
  }
}

const setSchema = z.object({
  weight: z.number().min(0).max(2000).optional(),
  reps: z.number().min(0).max(500).optional(),
  w: z.number().min(0).max(2000).optional(),
  r: z.number().min(0).max(500).optional(),
  sec: z.number().min(0).max(86400).optional(),
  min: z.number().min(0).max(1440).optional(),
  done: z.boolean().optional(),
}).strict()

export const addFoodEntry = {
  name: 'add_food_entry',
  description: 'Append one food entry to the Livy inbox. It is tagged source "livy" and is not applied twice when the same id is sent again. It does not change or delete existing entries. Macros are the totals for `amount`, not per unit. The app copies it in on the next open or sync.',
  schema: {
    id: z.string().min(1).max(80).describe('Stable id you choose, e.g. "livy-2026-10-10-oats". Reuse it if you retry.'),
    name: z.string().min(1).max(160),
    amount: z.number().positive().max(100000).optional().describe('How much was eaten. Defaults to 1.'),
    unit: z.string().min(1).max(32).optional().describe('Defaults to "serving".'),
    calories: z.number().min(0).max(20000).optional(),
    protein: z.number().min(0).max(2000).optional(),
    fat: z.number().min(0).max(2000).optional(),
    carbs: z.number().min(0).max(2000).optional(),
    fiber: z.number().min(0).max(500).optional(),
    date: isoDate().optional().describe('YYYY-MM-DD. Defaults to today on the machine running this server.'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe('HH:MM. Defaults to now on that machine.'),
    barcode: z.string().regex(/^\d{6,32}$/).optional(),
  },
  handler: (input) => submit('food', input),
}

export const addWorkoutEntry = {
  name: 'add_workout_entry',
  description: 'Append one finished workout to the Livy inbox. Tagged source "livy", idempotent on `id`, and it never edits or deletes an existing session. Each exercise needs exercise_id from the catalogue or from list_routines / get_workout, or exercise_name matching one exercise exactly. The app copies it in on the next open or sync.',
  schema: {
    id: z.string().min(1).max(80).describe('Stable id you choose. Reuse it if you retry.'),
    date: isoDate().optional().describe('YYYY-MM-DD. Defaults to today on the machine running this server.'),
    name: z.string().min(1).max(120).optional().describe('Session name. Defaults to "Workout".'),
    exercises: z.array(z.object({
      exercise_id: z.string().min(1).max(80).optional(),
      exercise_name: z.string().min(1).max(160).optional(),
      sets: z.array(setSchema).min(1).max(40),
    }).strict()).min(1).max(60),
  },
  handler: (input) => submit('workout', input),
}

function submit(kind, input) {
  const S = getState()
  if (!S) {
    return {
      error: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
      unit: 'kg',
    }
  }
  const resolve = kind === 'workout' ? (row => resolveExercise(S, row)) : undefined
  const result = appendInbox(dataDir(), getUser().id, { kind, ...input }, Date.now(), resolve)
  if (!result.ok) {
    const err = new Error(result.error || 'inbox write failed')
    err.code = result.error === 'inbox unreadable' ? 'EIO' : 'EINVAL'
    throw err
  }
  const added = result.added[0]
  if (!added) {
    const reason = result.skipped[0]?.reason || 'not added'
    if (reason === 'duplicate') {
      return { ok: true, id: input.id, kind, source: 'livy', added: false, duplicate: true, reason }
    }
    const err = new Error(reason)
    err.code = 'EINVAL'
    throw err
  }
  return { ok: true, id: added.id, kind, source: 'livy', added: true, duplicate: false, entry: added.entry }
}
