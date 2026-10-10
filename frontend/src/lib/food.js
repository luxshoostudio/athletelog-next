import { FOOD_ALIASES, FOOD_BANK } from './food-db.js'

export const FOOD_TARGETS = { calories: 1300, protein: 125, fiber: 25 }
const GOAL_KEYS = ['calories', 'protein', 'fiber', 'fat', 'carbs']
const LIMIT_KEYS = new Set(['calories', 'protein', 'fiber'])

// A stored goal counts only when it is a positive number. Blank, zero, and junk are unset,
// which is how fat and carbs stay off the books until someone types a number.
export function goalNumber(value) {
  if (value === '' || value == null || value === false) return null
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

// Calories, protein, and fiber fall back to the defaults. Fat and carbs are copied only when
// set, and they are never limits: going past them does not warn.
export function nutritionGoals(targets) {
  const src = targets && typeof targets === 'object' ? targets : {}
  const out = {}
  for (const key of ['calories', 'protein', 'fiber']) out[key] = goalNumber(src[key]) ?? FOOD_TARGETS[key]
  for (const key of ['fat', 'carbs']) {
    const set = goalNumber(src[key])
    if (set != null) out[key] = set
  }
  return out
}

export function macroIsLimit(key) {
  return LIMIT_KEYS.has(key)
}

export function macroOverLimit(key, value, goals = {}) {
  if (!macroIsLimit(key)) return false
  const goal = goalNumber(goals[key])
  return goal != null && Number(value) > goal
}

// What the daily-goals form writes. An empty fat or carbs field is left out, so the saved
// profile can keep those two unset.
export function nutritionTargetsFromForm(form = {}) {
  const out = {}
  for (const key of GOAL_KEYS) {
    const set = goalNumber(form[key])
    if (set != null) out[key] = set
  }
  return out
}

export function goalSuffix(key, goals, unit) {
  if (!macroIsLimit(key)) return unit
  const goal = goalNumber(goals?.[key])
  return goal == null ? unit : `/ ${goal} ${unit}`
}
const DAY = 86400000
const clean = value => String(value || '').trim().toLocaleLowerCase()
const n = value => Number.isFinite(Number(value)) ? Number(value) : 0

export const foodDay = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date)
  const p = x => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const foodTime = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function normalizedFood(item = {}, fallbackName = '') {
  return {
    name: String(item.name || fallbackName || '').trim(),
    protein: n(item.protein ?? item.p), calories: n(item.calories ?? item.kcal),
    fat: n(item.fat), carbs: n(item.carbs), fiber: n(item.fiber),
    unit: item.unit || 'serving', qty: n(item.qty) || 1,
    ...(item.barcode ? { barcode: String(item.barcode) } : {}),
    ...(item.source ? { source: item.source } : {}),
  }
}

export function foodCatalogue(S = {}) {
  const personal = Object.values(S.foodItems || {}).map(x => normalizedFood(x))
  const builtIn = Object.entries(FOOD_BANK).map(([name, x]) => normalizedFood(x, name))
  const seen = new Set()
  return [...personal, ...builtIn].filter(item => {
    const key = clean(item.name)
    if (!key || seen.has(key)) return false
    seen.add(key); return true
  })
}

function subsequence(needle, hay) {
  let i = 0
  for (const ch of hay) if (ch === needle[i]) i++
  return i === needle.length
}

export function foodSearch(S, query, limit = 12) {
  const q0 = clean(query)
  const q = FOOD_ALIASES[q0] || q0
  if (!q) return frequentFoods(S, limit)
  return foodCatalogue(S).map(item => {
    const name = clean(item.name)
    const score = name === q ? 1000 : name.startsWith(q) ? 700 : name.includes(q) ? 500 - name.indexOf(q) : subsequence(q, name) ? 100 : 0
    return { item, score }
  }).filter(x => x.score).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit).map(x => x.item)
}

const MACRO_KEYS = ['protein', 'calories', 'fat', 'carbs', 'fiber']
const roundMacro = (key, value) => +(n(value).toFixed(key === 'calories' ? 1 : 2))

// Catalogue foods and foodItems store nutrition per `qty` (100 g, 1 egg, 1 serving).
// A logged entry stores `amount` eaten and the totals for that amount. Passing an entry
// (it has `amount`) back through scaledFood used to treat those totals as per-qty values
// and multiply them again.
export function perUnitFood(item = {}) {
  const base = normalizedFood(item)
  const amount = n(item.amount)
  const qty = base.qty || 1
  if (!(amount > 0) || amount === qty) return base
  const factor = qty / amount
  const out = { ...base }
  for (const key of MACRO_KEYS) out[key] = roundMacro(key, base[key] * factor)
  return out
}

// `item` is per `qty`. `amount` is how much was eaten. The result is the totals for that amount.
export function scaledFood(item, amount) {
  const base = perUnitFood(item)
  const qty = base.qty || 1
  const eaten = n(amount) || qty
  const factor = eaten / qty
  const out = { ...base, amount: eaten }
  for (const key of MACRO_KEYS) out[key] = roundMacro(key, base[key] * factor)
  return out
}

// Totals the editor is showing, scaled from the portion they belonged to. Amount edits
// recompute from that base, so typing 200 after 2 does not compound.
export function macrosForAmount(baseAmount, macros = {}, nextAmount) {
  const from = n(baseAmount) || 1
  const to = n(nextAmount)
  if (!(to > 0)) return { ...macros }
  const factor = to / from
  const out = {}
  for (const key of MACRO_KEYS) {
    const raw = macros[key]
    out[key] = raw === '' || raw == null ? (raw ?? '') : roundMacro(key, n(raw) * factor)
  }
  return out
}

// What the food form saved: the numbers on screen are the totals for `amount`, not per-unit
// values waiting to be scaled a second time.
export function entryFromDraft(draft = {}) {
  const now = Date.now()
  const qty = n(draft.qty) || 1
  const amount = n(draft.amount) || qty
  return {
    name: String(draft.name || '').trim(),
    protein: n(draft.protein), calories: n(draft.calories), fat: n(draft.fat), carbs: n(draft.carbs), fiber: n(draft.fiber),
    unit: draft.unit || 'serving', qty, amount,
    id: draft.id || `food-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: draft.date || foodDay(), time: draft.time || foodTime(), createdAt: draft.createdAt || now,
    source: draft.source || 'manual',
    ...(draft.barcode ? { barcode: String(draft.barcode) } : {}),
    ...(draft.components ? { components: draft.components } : {}),
  }
}

export function makeFoodEntry(item, { amount, date, time, source, components } = {}) {
  const food = scaledFood(item, amount)
  const now = Date.now()
  return {
    ...food, id: `food-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: date || foodDay(), time: time || foodTime(), createdAt: now,
    source: source || food.source || 'manual', ...(components ? { components } : {}),
  }
}

export function totalsForDay(entries = [], day = foodDay()) {
  return entries.filter(x => x?.date === day).reduce((out, x) => {
    for (const key of ['calories', 'protein', 'fiber', 'fat', 'carbs']) out[key] += n(x[key])
    return out
  }, { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0 })
}

export function frequentFoods(S = {}, limit = 8, now = Date.now()) {
  const score = new Map()
  for (const entry of S.foodEntries || []) {
    const key = clean(entry?.name)
    if (!key) continue
    const age = Math.max(0, now - new Date(`${entry.date || foodDay()}T12:00:00`).getTime()) / DAY
    const cur = score.get(key) || { item: perUnitFood(entry), count: 0, score: 0, last: '', lastAmount: 0 }
    cur.count++; cur.score += Math.pow(0.5, age / 21)
    if ((entry.date || '') >= cur.last) {
      cur.last = entry.date || ''
      cur.lastAmount = n(entry.amount) || n(entry.qty) || 1
      cur.item = { ...perUnitFood(entry), lastAmount: cur.lastAmount }
    }
    score.set(key, cur)
  }
  return [...score.values()].sort((a, b) => b.score - a.score || b.count - a.count).slice(0, limit).map(x => x.item)
}

export function learnedBreakfast(S = {}) {
  const cutoff = Date.now() - 21 * DAY
  const morning = (S.foodEntries || []).filter(x => new Date(`${x.date || ''}T12:00:00`).getTime() >= cutoff && String(x.time || '') < '12:00')
  const days = new Set(morning.map(x => x.date)).size
  const threshold = Math.max(3, Math.ceil(days * 0.35))
  const groups = new Map()
  for (const entry of morning) {
    const key = clean(entry.name)
    if (!key) continue
    const cur = groups.get(key) || { days: new Set(), item: normalizedFood(entry), date: '' }
    cur.days.add(entry.date)
    if (entry.date >= cur.date) { cur.date = entry.date; cur.item = normalizedFood(entry) }
    groups.set(key, cur)
  }
  return [...groups.entries()].filter(([, x]) => x.days.size >= threshold).sort((a, b) => b[1].days.size - a[1].days.size).slice(0, 6).map(([, x]) => x.item)
}

export function breakfastEntry(S, opts = {}) {
  const components = learnedBreakfast(S)
  if (components.length < 2) return null
  const total = components.reduce((out, x) => {
    for (const key of ['calories', 'protein', 'fiber', 'fat', 'carbs']) out[key] += n(x[key])
    return out
  }, { name: 'Usual Breakfast', calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, qty: 1, unit: 'meal' })
  return makeFoodEntry(total, { ...opts, source: 'breakfast-preset', components })
}

export async function lookupBarcode(code, fetcher = fetch) {
  const barcode = String(code || '').replace(/\D/g, '')
  if (barcode.length < 6) throw new Error('Enter a valid barcode')
  const response = await fetcher(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,brands,nutriments,serving_quantity,serving_size`)
  if (!response.ok) throw new Error('Barcode lookup failed')
  const data = await response.json()
  if (!data?.product) return null
  const p = data.product, m = p.nutriments || {}
  return normalizedFood({
    name: [p.product_name, p.brands].filter(Boolean).join(' · ') || `Barcode ${barcode}`,
    protein: m.proteins_100g, calories: m['energy-kcal_100g'], fat: m.fat_100g,
    carbs: m.carbohydrates_100g, fiber: m.fiber_100g, qty: 100, unit: 'g', barcode, source: 'open-food-facts',
  })
}
