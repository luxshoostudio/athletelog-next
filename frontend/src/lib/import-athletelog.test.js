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
  })

  it('is non-destructive and blocks the same batch twice', () => {
    const state = { workouts: [{ id: 'kept' }], foodEntries: [], customEx: [], foodItems: {}, importBatches: [] }
    const first = athleteLogImport(backup, state)
    mergeAthleteLogImport(state, first)
    expect(state.workouts.some(x => x.id === 'kept')).toBe(true)
    expect(athleteLogImport(backup, state).duplicate).toBe(true)
  })
})
