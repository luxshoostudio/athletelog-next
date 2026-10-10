import { normalizedFood } from './food.js'

const hash = text => {
  let h = 2166136261
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0
const dateOfKey = key => /^alog_(\d{4})_(\d{2})_(\d{2})$/.exec(key)?.slice(1).join('-') || null
const startOf = (date, time = '12:00') => new Date(`${date}T${/^\d\d:\d\d$/.test(time) ? time : '12:00'}:00`).getTime()
const splitNumbers = value => String(value ?? '').split(/[,/x×\s]+/).map(num).filter(x => x > 0)
const wordsOf = name => String(name || '').toLowerCase().match(/[a-z0-9]+/g) || []
// Filler around an activity ("morning run", "static hold") is not itself an exercise.
const FILLER = new Set(['morning', 'evening', 'easy', 'long', 'outdoor', 'indoor', 'the', 'a', 'an', 'my', 'daily', 'light', 'slow', 'fast', 'steady', 'interval', 'tempo', 'session', 'workout', 'training', 'static', 'mins', 'min', 'minutes', 'mile', 'miles', 'km'])
const CARDIO = new Set(['run', 'running', 'jog', 'jogging', 'sprint', 'sprinting', 'walk', 'walking', 'hike', 'hiking', 'treadmill', 'cardio', 'cycle', 'cycling', 'bike', 'biking', 'swim', 'swimming', 'elliptical'])
const RUN = new Set(['run', 'running', 'jog', 'jogging', 'sprint', 'sprinting'])
const TIMED = new Set(['stretch', 'stretching', 'balance', 'balancing', 'hold', 'holding', 'plank', 'planks', 'warmup'])

function isWarmup(words) {
  if (words.includes('warmup')) return true
  const i = words.indexOf('warm')
  return i >= 0 && words[i + 1] === 'up'
}

// Whole words, and only when the name is that activity. "run" inside crunch, "walk" in
// farmer's walk, and "hike" in hip hike are lifts; a warm-up bench press is still a press.
function exerciseMode(exercise) {
  if (exercise?.run) return 'running'
  if (exercise?.hold) return 'time'
  const words = wordsOf(exercise?.name)
  const warmup = isWarmup(words)
  const meaningful = words.filter(w => !FILLER.has(w) && w !== 'warm' && w !== 'up' && !/^\d/.test(w))
  const timedWord = warmup || words.some(w => TIMED.has(w))
  const onlyKnown = meaningful.length > 0 && meaningful.every(w => CARDIO.has(w) || TIMED.has(w))
  const onlyTimed = (meaningful.length > 0 && meaningful.every(w => TIMED.has(w))) || (warmup && meaningful.every(w => TIMED.has(w)))
  if (onlyKnown && words.some(w => RUN.has(w)) && !timedWord) return 'running'
  if (onlyKnown && words.some(w => CARDIO.has(w)) && !timedWord) return 'cardio'
  if (onlyTimed && !words.some(w => CARDIO.has(w))) return 'time'
  return 'reps'
}

const logMode = mode => (mode === 'running' ? 'cardio' : mode)

function sessionMinutes(day, exercises) {
  const explicit = [day?.duration, day?.minutes, day?.gym?.duration, day?.gym?.minutes, day?.gym?.sessionMinutes].map(num).find(v => v > 0)
  if (explicit) return explicit
  let sum = 0
  for (const ex of exercises) {
    const min = num(ex?.runTime || ex?.duration || ex?.minutes)
    if (min > 0) sum += min
  }
  return sum
}

function customExercise(exercise) {
  const mode = exerciseMode(exercise)
  const logged = logMode(mode)
  return {
    id: `al-${hash(String(exercise.name).toLocaleLowerCase())}`,
    n: String(exercise.name || 'Imported exercise').toLocaleLowerCase(), custom: true,
    eq: logged === 'reps' ? 'custom' : 'body weight', bp: logged === 'cardio' ? 'cardio' : 'waist',
    tg: '', desc: 'Imported from AthleteLog', athleteLogMode: mode === 'running' ? 'running' : logged,
  }
}

function importedSets(exercise) {
  const mode = logMode(exerciseMode(exercise))
  const count = Math.max(1, num(exercise.sets) || splitNumbers(exercise.reps).length || 1)
  const rawWeight = String(exercise.weight || '').trim()
  const bodyweight = /^(?:bw|body\s*weight)$/i.test(rawWeight)
  const weights = splitNumbers(rawWeight)
  if (mode === 'cardio') {
    const min = num(exercise.runTime || exercise.duration || exercise.minutes)
    const miles = num(exercise.distance)
    const mph = min > 0 && miles > 0 ? miles / (min / 60) : 0
    return [{ min: min || 1, speed: +(mph * 1.609344).toFixed(3), distanceMi: miles || null, done: exercise.completed !== false, migrated: true }]
  }
  if (mode === 'time') {
    const text = `${exercise.runTime || ''} ${exercise.reps || ''} ${exercise.name || ''}`
    const mins = /([\d.]+)\s*min/i.exec(text)
    const secs = /([\d.]+)\s*(?:sec|s\b)/i.exec(text)
    const sec = mins ? num(mins[1]) * 60 : secs ? num(secs[1]) : num(exercise.reps) || 60
    return Array.from({ length: count }, (_, i) => ({
      sec, w: bodyweight ? 0 : (weights[i] ?? weights[0] ?? 0),
      done: exercise.completed !== false, migrated: true,
      ...(bodyweight ? { bodyweight: true } : {}),
    }))
  }
  const reps = splitNumbers(exercise.reps)
  return Array.from({ length: count }, (_, i) => ({
    w: bodyweight ? 0 : (weights[i] ?? weights[0] ?? 0), r: reps[i] ?? reps[0] ?? 0,
    done: exercise.completed !== false, migrated: true,
    ...(bodyweight ? { bodyweight: true } : {}),
    ...(exercise.feeling != null ? { rpe: num(exercise.feeling) } : {}),
    ...((String(exercise.sets || '').match(/[,a-z]/i) || String(exercise.reps || '').match(/[a-z]/i)) ? { migratedRaw: { sets: exercise.sets, reps: exercise.reps, weight: exercise.weight } } : {}),
  }))
}

export function athleteLogImport(raw, existing = {}) {
  const source = raw?.state && typeof raw.state === 'object' ? raw.state : raw
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Not an AthleteLog backup')
  const batchId = `athletelog-${hash(JSON.stringify(source))}`
  if ((existing.importBatches || []).includes(batchId)) return { duplicate: true, batchId, workouts: [], foodEntries: [], customEx: [] }
  const workouts = [], foodEntries = [], custom = new Map()
  for (const [key, day] of Object.entries(source)) {
    const date = dateOfKey(key)
    if (!date || !day || typeof day !== 'object') continue
    const foods = Array.isArray(day.food) ? day.food : []
    foods.forEach((food, index) => {
      const item = normalizedFood(food)
      if (!item.name) return
      foodEntries.push({
        ...item, id: `al-food-${hash(`${key}|${index}|${food.id || ''}|${food.name}|${food.time || ''}`)}`,
        date, time: /^\d\d:\d\d$/.test(food.time) ? food.time : '12:00',
        createdAt: startOf(date, food.time), source: food.source || 'athletelog-import',
        ...(Array.isArray(food.components) ? { components: food.components.map(normalizedFood) } : {}),
      })
    })
    const exercises = Array.isArray(day.gym?.exercises) ? day.gym.exercises.filter(x => x?.name) : []
    if (!exercises.length) continue
    const entries = exercises.map(exercise => {
      const customEx = customExercise(exercise); custom.set(customEx.id, customEx)
      const mode = logMode(exerciseMode(exercise))
      const loaded = splitNumbers(exercise.weight).length > 0 && !/^(?:bw|body\s*weight)$/i.test(String(exercise.weight || '').trim())
      return {
        id: customEx.id, sets: importedSets(exercise),
        target: mode === 'cardio' ? { id: customEx.id, mode, sets: 1, min: num(exercise.runTime) || 1, speed: 0 }
          : mode === 'time' ? { id: customEx.id, mode, sets: num(exercise.sets) || 1, sec: 60, bodyweight: !loaded, ...(loaded ? { weight: num(exercise.weight) } : {}) }
            : { id: customEx.id, mode, sets: num(exercise.sets) || 1, reps: splitNumbers(exercise.reps)[0] || 0, weight: num(exercise.weight), bodyweight: /bw/i.test(exercise.weight || '') },
      }
    })
    const start = startOf(date)
    const minutes = sessionMinutes(day, exercises)
    workouts.push({
      id: `al-workout-${hash(key)}`, d: date, start, ...(minutes > 0 ? { end: start + minutes * 60000 } : {}),
      routineIds: [], routineId: null, name: day.gym.session || 'AthleteLog', entries, prs: [], migrated: true,
    })
  }
  return { duplicate: false, batchId, workouts, foodEntries, customEx: [...custom.values()] }
}

export function mergeAthleteLogImport(S, imported) {
  if (imported.duplicate) return S
  const workoutIds = new Set((S.workouts || []).map(x => x.id))
  const foodIds = new Set((S.foodEntries || []).map(x => x.id))
  const customIds = new Set((S.customEx || []).map(x => x.id))
  S.workouts = [...(S.workouts || []), ...imported.workouts.filter(x => !workoutIds.has(x.id))].sort((a, b) => String(a.d).localeCompare(String(b.d)))
  S.foodEntries = [...(S.foodEntries || []), ...imported.foodEntries.filter(x => !foodIds.has(x.id))]
  S.customEx = [...(S.customEx || []), ...imported.customEx.filter(x => !customIds.has(x.id))]
  S.importBatches = [...new Set([...(S.importBatches || []), imported.batchId])]
  for (const entry of imported.foodEntries) {
    S.foodItems ||= {}; S.foodItems[entry.name.toLocaleLowerCase()] = normalizedFood(entry)
  }
  return S
}
