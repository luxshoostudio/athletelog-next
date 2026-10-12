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

const lux = () => ({
  unit: 'kg',
  routines: [
    { id: 'lux-upper', name: 'Upper', ex: [{ id: 'bench' }] },
    { id: 'lux-slow-run', name: 'Slow run', ex: [{ id: 'easy', min: 30, sets: 4 }] },
    { id: 'lux-lower', name: 'Lower Body', ex: [{ id: 'squat' }] },
    { id: 'lux-tempo-run', name: 'Tempo', ex: [] },
    { id: 'lux-shoulder-arm', name: 'Shoulder & Arm', ex: [{ id: 'raise' }] },
    { id: 'lux-long-run', name: 'Long run', ex: [{ id: 'long', sets: 1 }] },
  ],
  week: {
    1: 'lux-upper',
    2: 'lux-slow-run',
    3: 'lux-lower',
    4: 'lux-tempo-run',
    5: 'lux-shoulder-arm',
    6: 'lux-long-run',
  },
  nutritionTargets: { calories: 1300, protein: 125, fiber: 25 },
  workouts: [{ id: 'w1' }],
  foodEntries: [{ id: 'f1' }],
})

beforeEach(() => { _seedStateForTests(base()) })

describe('weekly plan tools', () => {
  test('an empty profile has no meals and does not invent workouts', () => {
    _seedStateForTests({ unit: 'kg', routines: [], week: {}, workouts: [], foodEntries: [] })
    const plan = getWeeklyPlan.handler()
    expect(plan.protein_g).toBeNull()
    expect(plan.fiber_g).toBeNull()
    const monday = plan.days.find(day => day.weekday_name === 'Monday')
    expect(monday.workout).toBeNull()
    expect(monday.routine_id).toBeNull()
    expect(monday.meals).toBeNull()
    expect(plan.updated_by).toBeNull()
  })

  test('Lux\'s week and nutrition targets are the plan when mealPlan is missing', () => {
    _seedStateForTests(lux())
    const plan = getWeeklyPlan.handler()
    const monday = plan.days.find(day => day.weekday === 1)
    const tuesday = plan.days.find(day => day.weekday === 2)
    const thursday = plan.days.find(day => day.weekday === 4)
    const saturday = plan.days.find(day => day.weekday === 6)
    const sunday = plan.days.find(day => day.weekday === 0)
    expect(monday.routine_id).toBe('lux-upper')
    expect(monday.workout).toEqual({ type: 'strength', name: 'Upper', detail: 'Upper', minutes: 0 })
    expect(tuesday.workout.type).toBe('run')
    expect(tuesday.workout.minutes).toBe(30)
    expect(thursday.workout.minutes).toBe(30)
    expect(saturday.workout.minutes).toBe(60)
    expect(sunday.workout).toBeNull()
    expect(plan.protein_g).toBe(125)
    expect(plan.fiber_g).toBe(25)
    expect(plan.days.every(day => day.meals == null)).toBe(true)
    expect(plan.updated_by).toBeNull()
  })

  test('a stored minute note and planMinutes win over the keyword defaults', () => {
    _seedStateForTests({
      routines: [{ id: 'lux-long-run', name: 'Long run', planDetail: 'Long run 45 min', ex: [{ min: 10, sets: 3 }] }],
      week: { 6: 'lux-long-run' },
    })
    expect(getWeeklyPlan.handler().days.find(day => day.weekday === 6).workout.minutes).toBe(45)
    _seedStateForTests({
      routines: [{ id: 'lux-slow-run', name: 'Slow run', planMinutes: 25, ex: [{ min: 10, sets: 9 }] }],
      week: { 2: 'lux-slow-run' },
    })
    expect(getWeeklyPlan.handler().days.find(day => day.weekday === 2).workout.minutes).toBe(25)
  })

  test('a coach write sets Monday meals and updates the routine already on that day', () => {
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
    expect(monday.routine_id).toBe('push')
    const tuesday = getWeeklyPlan.handler().days.find(day => day.weekday_name === 'Tuesday')
    expect(tuesday.routine_id).toBe(planRoutineId(2))
    expect(tuesday.workout.minutes).toBe(30)
    expect(getWeeklyPlan.handler().protein_g).toBe(125)
    expect(getWeeklyPlan.handler().fiber_g).toBe(25)
  })

  test('the stored profile updates Monday in place and keeps food and workouts', () => {
    setWeeklyPlan.handler({
      days: [{ weekday: 1, workout: { type: 'strength', name: 'Upper strength', detail: 'Upper' } }],
    })
    const state = getState()
    expect(state.routines.map(item => item.id)).toEqual(['push'])
    expect(state.week[1]).toBe('push')
    expect(state.routines.find(item => item.id === 'push')).toMatchObject({
      name: 'Upper strength',
      ex: [{ id: 'bench' }],
      planSource: 'livy',
    })
    expect(state.routines.some(item => String(item.id).startsWith('al-plan-'))).toBe(false)
    expect(state.workouts.map(item => item.id)).toEqual(['w1'])
    expect(state.foodEntries.map(item => item.id)).toEqual(['f1'])
    expect(state.mealPlan.updatedBy).toBe('livy')
  })

  test('writing Lux\'s Monday renames lux-upper and leaves the week alone', () => {
    _seedStateForTests(lux())
    const written = setWeeklyPlan.handler({
      days: [{ weekday_name: 'Monday', workout: { type: 'strength', name: 'Upper strength', detail: 'Upper strength' } }],
    })
    expect(written.days.find(day => day.weekday === 1).routine_id).toBe('lux-upper')
    const state = getState()
    expect(state.routines.find(item => item.id === 'lux-upper')).toMatchObject({
      name: 'Upper strength',
      ex: [{ id: 'bench' }],
    })
    expect(state.routines.map(item => item.id)).toEqual(lux().routines.map(item => item.id))
    expect(state.week[1]).toBe('lux-upper')
    expect(state.nutritionTargets).toEqual({ calories: 1300, protein: 125, fiber: 25 })
    expect(state.routines.some(item => String(item.id).startsWith('al-plan-'))).toBe(false)
  })

  test('a weekday it cannot read is rejected and the profile stays as it was', () => {
    expect(() => setWeeklyPlan.handler({ days: [{ weekday: 'Funday', workout: { name: 'Nope' } }] })).toThrow(/weekday/)
    expect(getState().routines.map(item => item.id)).toEqual(['push'])
    expect(getState().mealPlan).toBeUndefined()
  })
})
