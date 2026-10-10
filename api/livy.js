/* Livy's inbox.
 *
 * An external agent appends food and workout entries; it never edits or deletes what is already
 * logged. Each entry carries source 'livy' and an id the agent chose, so delivering the same id
 * again is a no-op. The app applies those entries on the next pull and can undo exactly the ones
 * the notice is about.
 *
 * Values are checked here, at the door, and again when the app applies an inbox file it did not
 * write itself. Anything that is not a field the food log or a finished workout already stores
 * is dropped.
 */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const LIVY_SOURCE = 'livy'
const NOTICE_CAP = 500

const fail = error => ({ ok: false, error })
const pad = n => String(n).padStart(2, '0')

export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function localTime(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(v + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return null
  return localDay(d) === v ? v : null
}

function plain(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function text(v, max) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > max || /[\u0000-\u001f]/.test(s)) return null
  return s
}

function num(v, min, max) {
  if (typeof v === 'boolean' || v == null || v === '') return null
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

function idOf(v) {
  return typeof v === 'string' && ID_RE.test(v) ? v : null
}

/** One food entry, in the shape Food.jsx stores. Macros are the totals for `amount`. */
export function validateLivyFood(input, now = Date.now()) {
  if (!plain(input)) return fail('food entry must be an object')
  const id = idOf(input.id)
  if (!id) return fail('id must be 1–80 letters, digits, ".", "_", ":" or "-"')
  const name = text(input.name, 160)
  if (!name) return fail('name is required')
  const amount = input.amount == null && input.qty == null ? 1 : num(input.amount ?? input.qty, 0.0001, 100000)
  if (amount == null) return fail('amount must be a number greater than 0')
  const unit = input.unit == null || input.unit === '' ? 'serving' : text(input.unit, 32)
  if (!unit) return fail('unit is not usable')
  const calories = num(input.calories ?? 0, 0, 20000)
  const protein = num(input.protein ?? 0, 0, 2000)
  const fat = num(input.fat ?? 0, 0, 2000)
  const carbs = num(input.carbs ?? 0, 0, 2000)
  const fiber = num(input.fiber ?? 0, 0, 500)
  if (calories == null) return fail('calories must be a number from 0 to 20000')
  if (protein == null) return fail('protein must be a number from 0 to 2000')
  if (fat == null) return fail('fat must be a number from 0 to 2000')
  if (carbs == null) return fail('carbs must be a number from 0 to 2000')
  if (fiber == null) return fail('fiber must be a number from 0 to 500')
  const date = input.date == null || input.date === '' ? localDay(new Date(now)) : isoDate(input.date)
  if (!date) return fail('date must be YYYY-MM-DD')
  const time = input.time == null || input.time === '' ? localTime(new Date(now)) : (TIME_RE.test(input.time) ? input.time : null)
  if (!time) return fail('time must be HH:MM')
  let barcode
  if (input.barcode != null && input.barcode !== '') {
    barcode = String(input.barcode).replace(/\s/g, '')
    if (!/^\d{6,32}$/.test(barcode)) return fail('barcode must be 6–32 digits')
  }
  const createdAt = num(input.createdAt, 0, 8.64e15)
  return {
    ok: true,
    entry: {
      id, name, amount, qty: amount, unit,
      protein, calories, fat, carbs, fiber,
      date, time, createdAt: createdAt == null ? now : createdAt,
      source: LIVY_SOURCE,
      ...(barcode ? { barcode } : {}),
    },
  }
}

function oneSet(raw) {
  if (!plain(raw)) return fail('each set must be an object')
  const w = num(raw.w ?? raw.weight ?? 0, 0, 2000)
  const r = num(raw.r ?? raw.reps ?? 0, 0, 500)
  const sec = num(raw.sec ?? 0, 0, 86400)
  const min = num(raw.min ?? 0, 0, 1440)
  if (w == null) return fail('set weight must be a number from 0 to 2000')
  if (r == null) return fail('set reps must be a number from 0 to 500')
  if (sec == null) return fail('set sec must be a number from 0 to 86400')
  if (min == null) return fail('set min must be a number from 0 to 1440')
  const done = raw.done == null ? true : raw.done === true
  return { ok: true, set: { w, r, ...(sec ? { sec } : {}), ...(min ? { min } : {}), done } }
}

/**
 * One finished workout, in the shape a logged session already has (`d`, `entries`, `sets`).
 * `resolveExercise`, when passed, turns an exercise name or id into a catalogue id and rejects
 * anything it cannot name exactly. Without it, `exercise_id` (or a stored entry `id`) is kept
 * only when it is a safe token — the apply step re-checks a file it did not author.
 */
export function validateLivyWorkout(input, now = Date.now(), resolveExercise) {
  if (!plain(input)) return fail('workout must be an object')
  const id = idOf(input.id)
  if (!id) return fail('id must be 1–80 letters, digits, ".", "_", ":" or "-"')
  const date = input.date == null && input.d == null ? localDay(new Date(now)) : isoDate(input.date || input.d)
  if (!date) return fail('date must be YYYY-MM-DD')
  const name = input.name == null || input.name === '' ? 'Workout' : text(input.name, 120)
  if (!name) return fail('name is not usable')
  const rows = Array.isArray(input.exercises) ? input.exercises : (Array.isArray(input.entries) ? input.entries : null)
  if (!rows || !rows.length || rows.length > 60) return fail('a workout needs 1–60 exercises')
  const entries = []
  for (const row of rows) {
    if (!plain(row)) return fail('each exercise must be an object')
    let exerciseId = null
    if (typeof resolveExercise === 'function') {
      const hit = resolveExercise(row)
      if (!hit?.id) return fail('exercise_id or an exact exercise_name is required')
      exerciseId = idOf(hit.id)
      if (!exerciseId) return fail('exercise_id is not usable')
    } else {
      exerciseId = idOf(row.exercise_id || row.id)
      if (!exerciseId) return fail('exercise_id is required')
    }
    const setsIn = Array.isArray(row.sets) ? row.sets : null
    if (!setsIn || !setsIn.length || setsIn.length > 40) return fail('each exercise needs 1–40 sets')
    const sets = []
    for (const raw of setsIn) {
      const s = oneSet(raw)
      if (!s.ok) return s
      sets.push(s.set)
    }
    entries.push({ id: exerciseId, sets })
  }
  const start = num(input.start, 0, 8.64e15)
  const end = num(input.end, 0, 8.64e15)
  const at = now
  const startAt = start == null ? at : start
  const endAt = end == null || end < startAt ? startAt : end
  return {
    ok: true,
    entry: {
      id, d: date, start: startAt, end: endAt, name,
      routineId: null, routineIds: [], entries, prs: [],
      source: LIVY_SOURCE,
    },
  }
}

function lists(S) {
  if (!Array.isArray(S.foodEntries)) S.foodEntries = []
  if (!Array.isArray(S.workouts)) S.workouts = []
  if (!Array.isArray(S.livyRejected)) S.livyRejected = []
}

/**
 * Append inbox items onto `S`. Existing food and workout entries are not rewritten. An id already
 * logged, or one an Undo rejected, is skipped. Mutates `S`.
 */
export function applyLivyItems(S, items) {
  if (!plain(S)) return { added: [], skipped: [] }
  lists(S)
  const rejected = new Set(S.livyRejected.filter(x => typeof x === 'string'))
  const foodIds = new Set(S.foodEntries.map(e => e?.id).filter(x => x != null))
  const workoutIds = new Set(S.workouts.map(w => w?.id).filter(x => x != null))
  const added = []
  const skipped = []
  const list = Array.isArray(items) ? items : []
  for (const item of list) {
    if (!plain(item)) { skipped.push({ id: null, reason: 'invalid' }); continue }
    const kind = item.kind
    const raw = plain(item.entry) ? item.entry : item
    const id = idOf(raw.id || item.id)
    if (!id) { skipped.push({ id: item.id ?? null, reason: 'id' }); continue }
    if (rejected.has(id) || foodIds.has(id) || workoutIds.has(id)) {
      skipped.push({ id, reason: 'duplicate' })
      continue
    }
    const v = kind === 'food' ? validateLivyFood({ ...raw, id }) : kind === 'workout' ? validateLivyWorkout({ ...raw, id }) : fail('kind')
    if (!v.ok) { skipped.push({ id, reason: v.error }); continue }
    if (kind === 'food') {
      S.foodEntries.push(v.entry)
      foodIds.add(id)
      const key = v.entry.name.toLocaleLowerCase()
      if (!plain(S.foodItems)) S.foodItems = {}
      if (!plain(S.foodItems[key])) S.foodItems[key] = {
        name: v.entry.name, protein: v.entry.protein, calories: v.entry.calories,
        fat: v.entry.fat, carbs: v.entry.carbs, fiber: v.entry.fiber,
        unit: v.entry.unit, qty: v.entry.qty, source: LIVY_SOURCE,
      }
    } else {
      S.workouts.push(v.entry)
      workoutIds.add(id)
    }
    added.push({ id, kind })
  }
  return { added, skipped }
}

/** Remove logged entries whose id is in `ids` and whose source is livy. Nothing else moves. */
export function undoLivyIds(S, ids) {
  if (!plain(S)) return { removed: [] }
  lists(S)
  const want = new Set((Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string'))
  const removed = []
  const drop = (list, kind) => list.filter(x => {
    if (plain(x) && want.has(x.id) && x.source === LIVY_SOURCE) { removed.push({ id: x.id, kind }); return false }
    return true
  })
  S.foodEntries = drop(S.foodEntries, 'food')
  S.workouts = drop(S.workouts, 'workout')
  const note = new Set([...(Array.isArray(S.livyNotified) ? S.livyNotified : []), ...removed.map(x => x.id)].filter(x => typeof x === 'string'))
  const reject = new Set([...S.livyRejected.filter(x => typeof x === 'string'), ...removed.map(x => x.id)])
  S.livyNotified = [...note].slice(-NOTICE_CAP)
  S.livyRejected = [...reject].slice(-NOTICE_CAP)
  return { removed }
}

/** Ids of Livy entries the notice has not been dismissed for, food first then workouts. */
export function livyNoticeIds(S) {
  const seen = new Set(Array.isArray(S?.livyNotified) ? S.livyNotified.filter(x => typeof x === 'string') : [])
  const ids = []
  for (const e of [...(S?.foodEntries || []), ...(S?.workouts || [])]) {
    if (plain(e) && e.source === LIVY_SOURCE && typeof e.id === 'string' && !seen.has(e.id)) ids.push(e.id)
  }
  return ids
}

export function livyNoticeText(n) {
  return n === 1 ? '1 entry added by Livy' : `${n} entries added by Livy`
}
