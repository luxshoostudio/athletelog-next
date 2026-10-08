import { FOOD_ALIASES, FOOD_BANK } from './food-db.js'

export const FOOD_TARGETS = { calories: 1300, protein: 140, fiber: 30 }
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

export function scaledFood(item, amount) {
  const base = normalizedFood(item)
  const factor = (n(amount) || base.qty) / base.qty
  return {
    ...base, amount: n(amount) || base.qty,
    protein: +(base.protein * factor).toFixed(2), calories: +(base.calories * factor).toFixed(1),
    fat: +(base.fat * factor).toFixed(2), carbs: +(base.carbs * factor).toFixed(2), fiber: +(base.fiber * factor).toFixed(2),
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
    const cur = score.get(key) || { item: normalizedFood(entry), count: 0, score: 0, last: '' }
    cur.count++; cur.score += Math.pow(0.5, age / 21)
    if ((entry.date || '') >= cur.last) { cur.last = entry.date || ''; cur.item = normalizedFood(entry) }
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
  let items = [...groups.entries()].filter(([, x]) => x.days.size >= threshold).sort((a, b) => b[1].days.size - a[1].days.size).slice(0, 6).map(([, x]) => x.item)
  if (!items.some(x => clean(x.name) === 'chia seeds')) items.push(normalizedFood(FOOD_BANK['chia seeds'], 'chia seeds'))
  return items.slice(0, 6)
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
