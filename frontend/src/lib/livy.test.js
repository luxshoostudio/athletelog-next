import { describe, expect, it } from 'vitest'
import { applyLivyItems, livyNoticeIds, livyNoticeText, undoLivyIds, validateLivyFood, validateLivyWorkout } from './livy.js'
import { stampChange, mergeStates } from './sync-merge.js'

const NOW = new Date('2026-10-10T15:04:00').getTime()
const food = (over = {}) => validateLivyFood({ id: 'livy-oats', name: 'oats', amount: 40, unit: 'g', calories: 150, protein: 5, date: '2026-10-10', time: '08:00', ...over }, NOW)
const item = (kind, entry) => ({ id: entry.id, kind, entry })

describe('validateLivyFood', () => {
  it('keeps the fields a food entry already stores and forces source livy', () => {
    const v = food()
    expect(v.ok).toBe(true)
    expect(v.entry).toMatchObject({
      id: 'livy-oats', name: 'oats', amount: 40, qty: 40, unit: 'g',
      calories: 150, protein: 5, fat: 0, carbs: 0, fiber: 0,
      date: '2026-10-10', time: '08:00', source: 'livy', createdAt: NOW,
    })
    expect(v.entry.mood).toBeUndefined()
  })

  it('drops fields the log does not store and refuses a bad id, name, or macro', () => {
    const extra = food({ mood: 'fine', note: 'journal', source: 'manual' })
    expect(extra.entry.source).toBe('livy')
    expect(extra.entry.note).toBeUndefined()
    expect(food({ id: '../x' }).ok).toBe(false)
    expect(food({ name: '  ' }).ok).toBe(false)
    expect(food({ calories: -1 }).ok).toBe(false)
    expect(food({ protein: 5000 }).ok).toBe(false)
    expect(food({ date: '2026-02-31' }).ok).toBe(false)
    expect(food({ time: '25:00' }).ok).toBe(false)
    expect(food({ barcode: '12ab' }).ok).toBe(false)
  })
})

describe('validateLivyWorkout', () => {
  const workout = (over = {}) => validateLivyWorkout({
    id: 'livy-push', date: '2026-10-10', name: 'Push',
    exercises: [{ exercise_id: '0033', sets: [{ weight: 40, reps: 8 }, { w: 40, r: 6, done: false }] }],
    ...over,
  }, NOW)

  it('stores a finished session with catalogue ids and source livy', () => {
    const v = workout()
    expect(v.ok).toBe(true)
    expect(v.entry).toMatchObject({
      id: 'livy-push', d: '2026-10-10', name: 'Push', source: 'livy', prs: [], routineId: null,
    })
    expect(v.entry.entries).toEqual([
      { id: '0033', sets: [{ w: 40, r: 8, done: true }, { w: 40, r: 6, done: false }] },
    ])
  })

  it('resolves one exact exercise name and rejects an unknown or ambiguous one', () => {
    const resolve = row => {
      if (row.exercise_id === '0033' || row.exercise_name === 'Bench Press') return { id: '0033' }
      if (row.exercise_name === 'Press') return null
      return null
    }
    const named = validateLivyWorkout({
      id: 'livy-bench', date: '2026-10-10',
      exercises: [{ exercise_name: 'Bench Press', sets: [{ reps: 5, weight: 60 }] }],
    }, NOW, resolve)
    expect(named.entry.entries[0].id).toBe('0033')
    expect(validateLivyWorkout({
      id: 'livy-nope', date: '2026-10-10',
      exercises: [{ exercise_name: 'Press', sets: [{ reps: 5 }] }],
    }, NOW, resolve).ok).toBe(false)
    expect(workout({ exercises: [] }).ok).toBe(false)
    expect(workout({ exercises: [{ exercise_id: 'bad id', sets: [{ reps: 5 }] }] }).ok).toBe(false)
  })

  it('accepts the stored shape again, so applying the inbox does not reject its own write', () => {
    const stored = workout().entry
    const again = validateLivyWorkout(stored, NOW)
    expect(again.ok).toBe(true)
    expect(again.entry.entries).toEqual(stored.entries)
    expect(again.entry.d).toBe('2026-10-10')
  })
})

describe('apply and undo', () => {
  const base = () => ({
    foodEntries: [{ id: 'mine', name: 'egg', date: '2026-10-10', calories: 70, protein: 6, source: 'manual' }],
    workouts: [{ id: 'w-mine', d: '2026-10-09', name: 'Mine', entries: [], source: 'manual' }],
    foodItems: {},
  })

  it('appends once, skips a second delivery, and does not rewrite an existing entry', () => {
    const S = base()
    const oats = food().entry
    const push = validateLivyWorkout({
      id: 'livy-push', date: '2026-10-10', name: 'Push',
      exercises: [{ exercise_id: '0033', sets: [{ weight: 40, reps: 8 }] }],
    }, NOW).entry
    const first = applyLivyItems(S, [item('food', oats), item('workout', push)])
    expect(first.added.map(x => x.id)).toEqual(['livy-oats', 'livy-push'])
    expect(S.foodEntries.map(x => x.id)).toEqual(['mine', 'livy-oats'])
    expect(S.foodEntries[0]).toMatchObject({ name: 'egg', calories: 70 })
    expect(S.workouts.map(x => x.id)).toEqual(['w-mine', 'livy-push'])
    expect(S.foodItems.oats).toMatchObject({ name: 'oats', calories: 150 })
    const second = applyLivyItems(S, [item('food', oats), item('workout', push)])
    expect(second.added).toEqual([])
    expect(second.skipped.map(x => x.reason)).toEqual(['duplicate', 'duplicate'])
    expect(S.foodEntries).toHaveLength(2)
  })

  it('undo removes only the livy entries in the notice', () => {
    const S = base()
    applyLivyItems(S, [item('food', food().entry), item('food', food({ id: 'livy-egg', name: 'egg white', calories: 17, protein: 4 }).entry)])
    expect(livyNoticeIds(S)).toEqual(['livy-oats', 'livy-egg'])
    expect(livyNoticeText(2)).toBe('2 entries added by Livy')
    const { removed } = undoLivyIds(S, livyNoticeIds(S))
    expect(removed.map(x => x.id)).toEqual(['livy-oats', 'livy-egg'])
    expect(S.foodEntries.map(x => x.id)).toEqual(['mine'])
    expect(S.workouts.map(x => x.id)).toEqual(['w-mine'])
    const again = applyLivyItems(S, [item('food', food().entry)])
    expect(again.added).toEqual([])
    expect(again.skipped[0].reason).toBe('duplicate')
  })

  it('does not delete a user entry that happens to share an id', () => {
    const S = base()
    S.workouts.push({ id: 'livy-push', d: '2026-10-10', name: 'Typed', entries: [{ id: '0033', sets: [] }], source: 'manual' })
    const { removed } = undoLivyIds(S, ['livy-push', 'mine', 'w-mine'])
    expect(removed).toEqual([])
    expect(S.workouts.map(x => x.name)).toEqual(['Mine', 'Typed'])
    expect(S.foodEntries).toHaveLength(1)
  })
})

describe('food sync stamps', () => {
  const bare = (over = {}) => ({ workouts: [], routines: [], foodEntries: [], foodItems: {}, nutritionTargets: { calories: 1300, protein: 140, fiber: 30 }, ...over })

  it('stamps a food add, edit, and delete so the debounced push is a real change', () => {
    const prev = bare()
    const added = bare({ foodEntries: [{ id: 'f1', name: 'oats', calories: 100 }] })
    expect(stampChange(prev, added, 1000)).toBeGreaterThanOrEqual(1000)
    expect(added.edited.foodEntries).toBeGreaterThanOrEqual(1000)

    const edited = bare({ foodEntries: [{ id: 'f1', name: 'oats', calories: 120 }] })
    stampChange(added, edited, 2000)
    expect(edited.edited.foodEntries).toBeGreaterThanOrEqual(2000)

    const removed = bare()
    stampChange(edited, removed, 3000)
    expect(removed.edited.foodEntries).toBeGreaterThanOrEqual(3000)
  })

  it('keeps food logged on one copy when the other copy only logged a workout', () => {
    const phone = bare({
      _ts: 100,
      foodEntries: [{ id: 'f1', name: 'oats', calories: 100 }],
      edited: { foodEntries: 100 },
    })
    const desktop = bare({
      _ts: 300,
      workouts: [{ id: 'w1', d: '2026-10-10', start: 1, entries: [] }],
      edited: { workouts: 300 },
    })
    // workouts has its own merge, so the stamp on edited.workouts is not what keeps the session.
    // The food field is: the phone changed it last, and the desktop never did.
    const out = mergeStates(phone, desktop)
    expect(out.workouts.map(w => w.id)).toEqual(['w1'])
    expect(out.foodEntries.map(f => f.id)).toEqual(['f1'])
  })
})
