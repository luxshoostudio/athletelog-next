// Weekly plan for the coach. Workouts reuse the weekday routines (al-plan-<getDay()>,
// Sunday is 0, the same key as S.week). Meals are mealPlan, which the training
// profile did not have. A write is marked updatedBy "livy" and never removes a
// routine or weekday slot it did not create.
import { z } from 'zod'
import { getState, saveState } from './state.js'

const WEEKDAYS = [
  { weekday: 1, name: 'Monday' },
  { weekday: 2, name: 'Tuesday' },
  { weekday: 3, name: 'Wednesday' },
  { weekday: 4, name: 'Thursday' },
  { weekday: 5, name: 'Friday' },
  { weekday: 6, name: 'Saturday' },
  { weekday: 0, name: 'Sunday' },
]

const NAMES = Object.fromEntries(WEEKDAYS.flatMap(day => [
  [day.name.toLowerCase(), day.weekday],
  [day.name.slice(0, 3).toLowerCase(), day.weekday],
]))

export function planRoutineId(weekday) {
  return `al-plan-${Number(weekday)}`
}

function invalid(message) {
  const err = new Error(message)
  err.code = 'EINVAL'
  return err
}

function noState() {
  return {
    error: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
  }
}

function weekdayOf(day) {
  if (Number.isInteger(day?.weekday) && day.weekday >= 0 && day.weekday <= 6) return day.weekday
  const named = String(day?.weekday_name || day?.weekday || '').trim().toLowerCase()
  if (named in NAMES) return NAMES[named]
  throw invalid('each day needs a weekday from 0 (Sunday) to 6 (Saturday), or a weekday name')
}

function mealOf(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    name: String(raw.name || '').trim(),
    protein: Number(raw.protein) || 0,
    ...(raw.optional ? { optional: true } : {}),
  }
}

function view(state) {
  const routines = Array.isArray(state?.routines) ? state.routines : []
  const mealPlan = state?.mealPlan && typeof state.mealPlan === 'object' ? state.mealPlan : null
  const byId = new Map(routines.filter(item => item?.athleteLogPlan).map(item => [item.id, item]))
  const updatedBy = mealPlan?.updatedBy === 'livy' || [...byId.values()].some(item => item.planSource === 'livy') ? 'livy' : null
  return {
    protein_g: mealPlan && mealPlan.protein != null ? Number(mealPlan.protein) : null,
    fiber_g: mealPlan && mealPlan.fiber != null ? Number(mealPlan.fiber) : null,
    updated_by: updatedBy,
    days: WEEKDAYS.map(day => {
      const routine = byId.get(planRoutineId(day.weekday)) || null
      const meals = mealPlan?.days?.[String(day.weekday)] || mealPlan?.days?.[day.weekday] || null
      const snacks = Array.isArray(meals?.snacks) ? meals.snacks.map(mealOf).filter(Boolean) : []
      return {
        weekday: day.weekday,
        weekday_name: day.name,
        routine_id: routine?.id || planRoutineId(day.weekday),
        workout: routine ? {
          type: routine.planType || 'strength',
          name: routine.name || '',
          detail: routine.planDetail || routine.name || '',
          minutes: Number(routine.planMinutes) || 0,
        } : null,
        meals: meals ? {
          breakfast: mealOf(meals.breakfast),
          lunch: mealOf(meals.lunch),
          dinner: mealOf(meals.dinner),
          snacks,
        } : null,
      }
    }),
  }
}

function linkWeek(week, weekday, id) {
  const current = week[weekday]
  const ids = [].concat(current || []).filter(item => item != null && item !== '').map(String)
  if (ids.includes(id)) return
  ids.push(id)
  week[weekday] = ids.length === 1 ? id : ids
}

export function applyWeeklyPlan(state, input = {}, now = Date.now()) {
  const next = JSON.parse(JSON.stringify(state && typeof state === 'object' ? state : {}))
  if (!Array.isArray(next.routines)) next.routines = []
  if (!next.week || typeof next.week !== 'object' || Array.isArray(next.week)) next.week = {}
  const meal = next.mealPlan && typeof next.mealPlan === 'object' ? next.mealPlan : { protein: 125, fiber: 25, days: {} }
  if (!meal.days || typeof meal.days !== 'object') meal.days = {}
  const stamp = Math.max(Number(now) || 0, Number(meal._ts) || 0, Number(next._ts) || 0) + 1
  if (input.protein_g != null) meal.protein = input.protein_g
  if (input.fiber_g != null) meal.fiber = input.fiber_g
  if (meal.protein == null) meal.protein = 125
  if (meal.fiber == null) meal.fiber = 25
  meal.updatedBy = 'livy'
  meal._ts = stamp
  for (const day of input.days || []) {
    const weekday = weekdayOf(day)
    const id = planRoutineId(weekday)
    if (day.workout) {
      const at = next.routines.findIndex(item => item?.id === id)
      const prev = at >= 0 ? next.routines[at] : { id, ex: [] }
      const type = day.workout.type || prev.planType || 'strength'
      const name = day.workout.name != null ? String(day.workout.name).trim() : (prev.name || 'Workout')
      const routine = {
        ...prev,
        id,
        name: name || prev.name || 'Workout',
        emoji: type === 'run' ? '🏃' : type === 'rest' ? '😴' : '💪',
        ex: Array.isArray(prev.ex) ? prev.ex : [],
        athleteLogPlan: true,
        planType: type,
        planDetail: day.workout.detail != null ? String(day.workout.detail).trim() : (prev.planDetail || name),
        planMinutes: type === 'run' ? Number(day.workout.minutes ?? prev.planMinutes) || 0 : 0,
        planSource: 'livy',
        _ts: stamp,
      }
      if (at < 0) next.routines.push(routine)
      else next.routines[at] = routine
      linkWeek(next.week, weekday, id)
    }
    if (day.meals) {
      const key = String(weekday)
      const have = meal.days[key] && typeof meal.days[key] === 'object' ? meal.days[key] : {}
      const meals = { ...have }
      for (const slot of ['breakfast', 'lunch', 'dinner']) {
        if (day.meals[slot]) meals[slot] = mealOf(day.meals[slot])
      }
      if (Array.isArray(day.meals.snacks)) meals.snacks = day.meals.snacks.map(mealOf)
      else if (day.meals.snack) meals.snacks = [mealOf(day.meals.snack)]
      meal.days[key] = meals
    }
  }
  next.mealPlan = meal
  next.edited = { ...(next.edited && typeof next.edited === 'object' ? next.edited : {}), mealPlan: stamp }
  next._ts = stamp
  return next
}

const mealSlot = z.object({
  name: z.string().max(240).optional(),
  protein: z.number().min(0).max(500).optional(),
  optional: z.boolean().optional(),
})

const dayInput = z.object({
  weekday: z.union([z.number().int().min(0).max(6), z.string().min(1).max(20)]).optional(),
  weekday_name: z.string().min(1).max(20).optional(),
  workout: z.object({
    type: z.enum(['strength', 'run', 'rest']).optional(),
    name: z.string().max(80).optional(),
    detail: z.string().max(160).optional(),
    minutes: z.number().min(0).max(600).optional(),
  }).optional(),
  meals: z.object({
    breakfast: mealSlot.optional(),
    lunch: mealSlot.optional(),
    dinner: mealSlot.optional(),
    snack: mealSlot.optional(),
    snacks: z.array(mealSlot).max(6).optional(),
  }).optional(),
})

export const getWeeklyPlan = {
  name: 'get_weekly_plan',
  description: 'Read the weekly training and meal plan. Workouts are the weekday routines whose ids are al-plan-<weekday> (Sunday is 0, the same key as the profile week). Meals are breakfast, lunch, dinner, and snacks, with a rough protein for each, plus the daily protein and fiber targets. updated_by is "livy" when the coach last wrote the plan.',
  schema: {},
  handler: () => {
    const state = getState()
    if (!state) return noState()
    return view(state)
  },
}

export const setWeeklyPlan = {
  name: 'set_weekly_plan',
  description: 'Write the weekly plan. Send only the days and targets that change. Workouts are stored as the weekday plan routines (other routines already on that day stay). Meals are stored on mealPlan. The write is marked updated by Livy. It does not delete workouts, food, or routines it was not given.',
  schema: {
    protein_g: z.number().min(0).max(500).optional().describe('Daily protein target in grams.'),
    fiber_g: z.number().min(0).max(200).optional().describe('Daily fiber target in grams.'),
    days: z.array(dayInput).max(7).optional().describe('Days to change. weekday is 0–6 (Sunday is 0) or a name such as Monday.'),
  },
  handler: (input = {}) => {
    const state = getState()
    if (!state) return noState()
    const next = applyWeeklyPlan(state, input, Date.now())
    saveState(next)
    return { ok: true, updated_by: 'livy', ...view(next) }
  },
}
