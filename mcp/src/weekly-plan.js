// Weekly plan for the coach.
//
// A day already assigned on `week` is that routine (lux-upper, and the rest of
// Lux's week). get_weekly_plan reads it, and falls back to nutritionTargets
// when mealPlan has no protein or fiber yet. set_weekly_plan updates that
// routine in place. An al-plan-<weekday> routine is created only when the day
// has no routine and the workout is not rest. Sunday is 0, matching S.week.
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

function isPlanRoutineId(id) {
  return /^al-plan-[0-6]$/.test(String(id || ''))
}

function assignedIds(week, weekday) {
  if (!week || typeof week !== 'object' || Array.isArray(week)) return []
  return [].concat(week[weekday] ?? week[String(weekday)] ?? [])
    .filter(id => id != null && id !== '')
    .map(String)
}

function routineForWeekday(state, weekday) {
  const routines = Array.isArray(state?.routines) ? state.routines : []
  const byId = new Map(routines.filter(item => item?.id).map(item => [String(item.id), item]))
  const assigned = assignedIds(state?.week, weekday).map(id => byId.get(id)).filter(Boolean)
  const preferred = assigned.find(item => !isPlanRoutineId(item.id)) || assigned.find(item => isPlanRoutineId(item.id))
  if (preferred) return preferred
  const synthetic = byId.get(planRoutineId(weekday))
  return synthetic?.athleteLogPlan ? synthetic : null
}

export function inferWorkoutType(routine) {
  if (['strength', 'run', 'rest'].includes(routine?.planType)) return routine.planType
  const blob = `${routine?.id || ''} ${routine?.name || ''} ${routine?.planDetail || ''}`.toLowerCase()
  if (/\brest\b/.test(blob)) return 'rest'
  if (/\b(run|jog|tempo)\b/.test(blob)) return 'run'
  return 'strength'
}

// Minutes already stored win. Otherwise a "30 min" note, then the sum of
// cardio exercise minutes (sets are not a multiplier), then 30 for a slow or
// tempo run and 60 for a long run.
export function workoutMinutes(routine, type = inferWorkoutType(routine)) {
  const stored = Number(routine?.planMinutes)
  if (Number.isFinite(stored) && stored > 0) return stored
  const described = `${routine?.name || ''} ${routine?.planDetail || ''}`
  const named = described.match(/(\d+)\s*min\b/i)
  if (named) return Number(named[1])
  if (type === 'run' && Array.isArray(routine?.ex)) {
    const sum = routine.ex.reduce((total, item) => total + (Number(item?.min) || 0), 0)
    if (sum > 0) return sum
  }
  if (type === 'run') {
    const blob = `${routine?.id || ''} ${routine?.name || ''}`.toLowerCase()
    if (/\blong\b/.test(blob)) return 60
    if (/\b(slow|tempo)\b/.test(blob)) return 30
  }
  return 0
}

function numberOrNull(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function targetOf(state, key) {
  const fromMeals = numberOrNull(state?.mealPlan?.[key])
  if (fromMeals != null) return fromMeals
  return numberOrNull(state?.nutritionTargets?.[key])
}

function workoutView(routine) {
  const type = inferWorkoutType(routine)
  return {
    type,
    name: routine.name || '',
    detail: routine.planDetail || routine.name || '',
    minutes: type === 'run' ? workoutMinutes(routine, type) : (Number(routine.planMinutes) || 0),
  }
}

function view(state) {
  const mealPlan = state?.mealPlan && typeof state.mealPlan === 'object' ? state.mealPlan : null
  const days = WEEKDAYS.map(day => {
    const routine = routineForWeekday(state, day.weekday)
    const meals = mealPlan?.days?.[String(day.weekday)] || mealPlan?.days?.[day.weekday] || null
    const snacks = Array.isArray(meals?.snacks) ? meals.snacks.map(mealOf).filter(Boolean) : []
    return {
      weekday: day.weekday,
      weekday_name: day.name,
      routine_id: routine?.id || null,
      routine,
      workout: routine ? workoutView(routine) : null,
      meals: meals ? {
        breakfast: mealOf(meals.breakfast),
        lunch: mealOf(meals.lunch),
        dinner: mealOf(meals.dinner),
        snacks,
      } : null,
    }
  })
  const updatedBy = mealPlan?.updatedBy === 'livy' || days.some(day => day.routine?.planSource === 'livy') ? 'livy' : null
  return {
    protein_g: targetOf(state, 'protein'),
    fiber_g: targetOf(state, 'fiber'),
    updated_by: updatedBy,
    days: days.map(({ routine, ...day }) => day),
  }
}

function linkWeek(week, weekday, id) {
  const current = week[weekday] ?? week[String(weekday)]
  const ids = [].concat(current || []).filter(item => item != null && item !== '').map(String)
  if (ids.includes(id)) return
  ids.push(id)
  week[weekday] = ids.length === 1 ? id : ids
}

function writeTargets(next, input) {
  if (input.protein_g == null && input.fiber_g == null) return
  const goals = next.nutritionTargets && typeof next.nutritionTargets === 'object' && !Array.isArray(next.nutritionTargets)
    ? { ...next.nutritionTargets }
    : {}
  if (input.protein_g != null) goals.protein = input.protein_g
  if (input.fiber_g != null) goals.fiber = input.fiber_g
  next.nutritionTargets = goals
}

export function applyWeeklyPlan(state, input = {}, now = Date.now()) {
  const next = JSON.parse(JSON.stringify(state && typeof state === 'object' ? state : {}))
  if (!Array.isArray(next.routines)) next.routines = []
  if (!next.week || typeof next.week !== 'object' || Array.isArray(next.week)) next.week = {}
  const meal = next.mealPlan && typeof next.mealPlan === 'object' ? next.mealPlan : { days: {} }
  if (!meal.days || typeof meal.days !== 'object') meal.days = {}
  const stamp = Math.max(Number(now) || 0, Number(meal._ts) || 0, Number(next._ts) || 0) + 1
  writeTargets(next, input)
  if (input.protein_g != null) meal.protein = input.protein_g
  if (input.fiber_g != null) meal.fiber = input.fiber_g
  if (meal.protein == null) meal.protein = numberOrNull(next.nutritionTargets?.protein) ?? 125
  if (meal.fiber == null) meal.fiber = numberOrNull(next.nutritionTargets?.fiber) ?? 25
  meal.updatedBy = 'livy'
  meal._ts = stamp
  for (const day of input.days || []) {
    const weekday = weekdayOf(day)
    if (day.workout) {
      const existing = routineForWeekday(next, weekday)
      const type = day.workout.type || (existing ? inferWorkoutType(existing) : 'strength')
      if (existing || type !== 'rest') {
        const id = existing?.id || planRoutineId(weekday)
        const at = next.routines.findIndex(item => item?.id === id)
        const prev = at >= 0 ? next.routines[at] : { id, ex: [] }
        const name = day.workout.name != null ? String(day.workout.name).trim() : (prev.name || 'Workout')
        const routine = {
          ...prev,
          id,
          name: name || prev.name || 'Workout',
          emoji: type === 'run' ? '🏃' : type === 'rest' ? '😴' : '💪',
          ex: Array.isArray(prev.ex) ? prev.ex : [],
          planType: type,
          planDetail: day.workout.detail != null ? String(day.workout.detail).trim() : (prev.planDetail || name),
          planMinutes: type === 'run' ? Number(day.workout.minutes ?? prev.planMinutes) || 0 : 0,
          planSource: 'livy',
          _ts: stamp,
        }
        if (isPlanRoutineId(id)) routine.athleteLogPlan = true
        if (at < 0) next.routines.push(routine)
        else next.routines[at] = routine
        if (!existing) linkWeek(next.week, weekday, id)
      }
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
  description: 'Read the weekly training and meal plan. Each day uses the routine already assigned on the profile week (Sunday is 0). A day with no routine has a null workout. Daily protein and fiber come from mealPlan when set, otherwise from nutritionTargets. Meals are null until mealPlan exists. updated_by is "livy" when the coach last wrote the plan.',
  schema: {},
  handler: () => {
    const state = getState()
    if (!state) return noState()
    return view(state)
  },
}

export const setWeeklyPlan = {
  name: 'set_weekly_plan',
  description: 'Write the weekly plan. Send only the days and targets that change. A workout updates the routine already assigned to that day and keeps its id and exercises. A new al-plan-<weekday> routine is added only when that day has no routine and the workout is not rest. Protein and fiber also update nutritionTargets without clearing the other targets. Meals are stored on mealPlan. The write is marked updated by Livy.',
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
