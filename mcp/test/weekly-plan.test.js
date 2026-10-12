import { describe, test, expect, beforeEach } from 'vitest'
import { _seedStateForTests, getState } from '../src/state.js'
import { getWeeklyPlan, setWeeklyPlan, planRoutineId } from '../src/weekly-plan.js'

const base = () => ({
  unit: 'kg',
  routines: [{ id: 'push', name: 'Push', ex: [{ id: 'bench' }] }],
  week: { 1: 'push' },
  workouts: [{ id: 'w1', d: '2026-10-10' }],
  foodEntries: [{ id: 'f1', name: 'oats' }],
})

beforeEach(() => { _seedStateForTests(base()) })

describe('weekly plan tools', () => {
  test('an empty profile has no meals and does not invent workouts', () => {
    const plan = getWeeklyPlan.handler()
    expect(plan.protein_g).toBeNull()
    expect(plan.days.find(day => day.weekday_name === 'Monday').workout).toBeNull()
    expect(plan.updated_by).toBeNull()
  })

  test('a coach write sets Monday meals and marks the plan updated by Livy', () => {
    const written = setWeeklyPlan.handler({
      protein_g: 125,
      fiber_g: 25,
      days: [{
        weekday_name: 'Monday',
        workout: { type: 'strength', name: 'Upper strength', detail: 'Upper' },
        meals: {
          breakfast: { name: 'Greek yogurt (double) + blueberries + raspberries + overnight oats + chia', protein: 45 },
          lunch: { name: 'Chicken + rice/quinoa + peas + a tea egg', protein: 50 },
          snack: { name: 'Protein shake', protein: 30 },
          dinner: { name: 'Optional', protein: 0, optional: true },
        },
      }, {
        weekday: 'Tuesday',
        workout: { type: 'run', name: 'Slow run', detail: 'Slow run 30 min', minutes: 30 },
      }],
    })
    expect(written.ok).toBe(true)
    expect(written.updated_by).toBe('livy')
    const monday = written.days.find(day => day.weekday === 1)
    expect(monday.workout.name).toBe('Upper strength')
    expect(monday.meals.breakfast.protein).toBe(45)
    expect(monday.meals.snacks[0].name).toBe('Protein shake')
    expect(monday.meals.dinner.optional).toBe(true)
    expect(monday.routine_id).toBe(planRoutineId(1))
    const tuesday = getWeeklyPlan.handler().days.find(day => day.weekday_name === 'Tuesday')
    expect(tuesday.workout.minutes).toBe(30)
    expect(getWeeklyPlan.handler().protein_g).toBe(125)
    expect(getWeeklyPlan.handler().fiber_g).toBe(25)
  })

  test('the stored profile keeps food, workouts, and the other Monday routine', () => {
    setWeeklyPlan.handler({
      days: [{ weekday: 1, workout: { type: 'strength', name: 'Upper strength', detail: 'Upper' } }],
    })
    const state = getState()
    expect(state.routines.map(item => item.id)).toEqual(expect.arrayContaining(['push', planRoutineId(1)]))
    expect([].concat(state.week[1])).toEqual(expect.arrayContaining(['push', planRoutineId(1)]))
    expect(state.workouts.map(item => item.id)).toEqual(['w1'])
    expect(state.foodEntries.map(item => item.id)).toEqual(['f1'])
    expect(state.mealPlan.updatedBy).toBe('livy')
    expect(state.routines.find(item => item.id === 'push').ex).toEqual([{ id: 'bench' }])
  })

  test('a weekday it cannot read is rejected and the profile stays as it was', () => {
    expect(() => setWeeklyPlan.handler({ days: [{ weekday: 'Funday', workout: { name: 'Nope' } }] })).toThrow(/weekday/)
    expect(getState().routines.map(item => item.id)).toEqual(['push'])
    expect(getState().mealPlan).toBeUndefined()
  })
})
