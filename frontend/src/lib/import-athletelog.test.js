import { describe, expect, it } from 'vitest'
import { athleteLogImport, mergeAthleteLogImport } from './import-athletelog.js'

const backup = {
  alog_2026_09_01: {
    food: [{ id: 'f1', name: 'greek yogurt', p: 10, kcal: 59, fiber: 0, time: '09:15' }],
    gym: { session: 'Upper', exercises: [
      { name: 'Bent over row', completed: true, sets: '3', reps: '10,9,8', weight: '95' },
      { name: 'Morning stretching', completed: true, sets: '1', reps: '10 min', weight: '' },
      { name: 'Running', completed: true, run: true, distance: '3.1', runTime: '30' },
    ] },
  },
}

describe('AthleteLog import', () => {
  it('converts food and each training mode without losing the original date', () => {
    const out = athleteLogImport(backup, {})
    expect(out.foodEntries[0]).toMatchObject({ date: '2026-09-01', time: '09:15', protein: 10, calories: 59 })
    expect(out.workouts[0].d).toBe('2026-09-01')
    expect(out.workouts[0].entries[0].sets.map(x => x.r)).toEqual([10, 9, 8])
    expect(out.workouts[0].entries[1].target.mode).toBe('time')
    expect(out.workouts[0].entries[2].target.mode).toBe('cardio')
    expect(out.workouts[0].entries[2].sets[0].distanceMi).toBe(3.1)
    expect(out.workouts[0].end - out.workouts[0].start).toBe(30 * 60000)
    expect(out.customEx.find(c => c.n === 'running').athleteLogMode).toBe('running')
  })

  it('keeps reps and weight on lifts whose names only look like cardio or a hold', () => {
    const day = exercises => ({ alog_2026_09_02: { gym: { exercises } } })
    const one = name => athleteLogImport(day([{ name, completed: true, sets: '3', reps: '12,10,8', weight: '40' }]), {})
    for (const name of ['Crunches', 'Trunk rotation', "Farmer's walk", 'Walking lunge', 'Hip hike', 'Cable crunch', 'Warm-up bench press']) {
      const entry = one(name).workouts[0].entries[0]
      expect(entry.target.mode, name).toBe('reps')
      expect(entry.sets.map(s => s.r), name).toEqual([12, 10, 8])
      expect(entry.sets.map(s => s.w), name).toEqual([40, 40, 40])
    }
    const plank = one('Plank').workouts[0].entries[0]
    expect(plank.target.mode).toBe('time')
    expect(plank.sets.every(s => s.w === 40)).toBe(true)
    expect(one('Cable crunch').workouts[0].end).toBeUndefined()
  })

  it('uses a real session duration and does not invent an hour', () => {
    const out = athleteLogImport({ alog_2026_09_03: { gym: { duration: 45, exercises: [{ name: 'Bent over row', sets: '1', reps: '5', weight: '60' }] } } }, {})
    expect(out.workouts[0].end - out.workouts[0].start).toBe(45 * 60000)
  })

  it('gives two foods with the same name and time different ids', () => {
    const out = athleteLogImport({ alog_2026_09_04: { food: [
      { name: 'oats', time: '08:00', p: 5, kcal: 100 },
      { name: 'oats', time: '08:00', p: 6, kcal: 120 },
    ] } }, {})
    expect(out.foodEntries.map(e => e.id)).toHaveLength(2)
    expect(new Set(out.foodEntries.map(e => e.id)).size).toBe(2)
  })

  it('is non-destructive and blocks the same batch twice', () => {
    const state = { workouts: [{ id: 'kept' }], foodEntries: [], customEx: [], foodItems: {}, importBatches: [] }
    const first = athleteLogImport(backup, state)
    mergeAthleteLogImport(state, first)
    expect(state.workouts.some(x => x.id === 'kept')).toBe(true)
    expect(athleteLogImport(backup, state).duplicate).toBe(true)
  })
})
