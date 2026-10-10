import { describe, expect, it } from 'vitest'
import { FOOD_TARGETS, breakfastEntry, entryFromDraft, foodSearch, frequentFoods, goalSuffix, learnedBreakfast, lookupBarcode, macroIsLimit, macroOverLimit, macrosForAmount, makeFoodEntry, nutritionGoals, nutritionTargetsFromForm, perUnitFood, scaledFood, totalsForDay } from './food.js'

describe('daily nutrition goals', () => {
  it('defaults protein to 125 g and fiber to 25 g, and leaves fat and carbs unset', () => {
    expect(FOOD_TARGETS).toEqual({ calories: 1300, protein: 125, fiber: 25 })
    expect(nutritionGoals()).toEqual({ calories: 1300, protein: 125, fiber: 25 })
    expect(nutritionGoals({}).fat).toBeUndefined()
    expect(nutritionGoals({}).carbs).toBeUndefined()
  })

  it('keeps a saved goal and still lets fat and carbs stay unset', () => {
    expect(nutritionGoals({ protein: 180, fiber: '' })).toMatchObject({ protein: 180, fiber: 25, calories: 1300 })
    expect(nutritionGoals({ fat: 70, carbs: 0 })).toMatchObject({ fat: 70 })
    expect(nutritionGoals({ fat: 70, carbs: 0 }).carbs).toBeUndefined()
    expect(nutritionGoals({ fat: '', carbs: null }).fat).toBeUndefined()
  })

  it('shows fat and carbs without treating them as limits', () => {
    const goals = nutritionGoals({ fat: 20, carbs: 40, protein: 125 })
    expect(macroIsLimit('fat')).toBe(false)
    expect(macroIsLimit('carbs')).toBe(false)
    expect(macroIsLimit('protein')).toBe(true)
    expect(macroOverLimit('fat', 80, goals)).toBe(false)
    expect(macroOverLimit('carbs', 200, goals)).toBe(false)
    expect(macroOverLimit('protein', 200, goals)).toBe(true)
    expect(goalSuffix('fat', goals, 'g')).toBe('g')
    expect(goalSuffix('carbs', goals, 'g')).toBe('g')
    expect(goalSuffix('protein', goals, 'g')).toBe('/ 125 g')
  })

  it('drops a cleared fat or carbs field so the saved goals can leave them unset', () => {
    expect(nutritionTargetsFromForm({ calories: '1300', protein: '125', fiber: '25', fat: '', carbs: '  ' }))
      .toEqual({ calories: 1300, protein: 125, fiber: 25 })
    expect(nutritionTargetsFromForm({ calories: '1500', protein: '160', fiber: '30', fat: '60', carbs: '180' }))
      .toEqual({ calories: 1500, protein: 160, fiber: 30, fat: 60, carbs: 180 })
  })
})

describe('food log', () => {
  it('searches fuzzily and resolves aliases', () => {
    expect(foodSearch({}, 'yogurt')[0].name).toBe('greek yogurt')
    expect(foodSearch({}, 'grk ygurt').map(x => x.name)).toContain('greek yogurt')
  })

  it('totals only the selected date', () => {
    const entries = [
      makeFoodEntry({ name: 'a', calories: 100, protein: 10, fiber: 2 }, { date: '2026-10-08' }),
      makeFoodEntry({ name: 'b', calories: 50, protein: 5, fiber: 1 }, { date: '2026-10-07' }),
    ]
    expect(totalsForDay(entries, '2026-10-08')).toMatchObject({ calories: 100, protein: 10, fiber: 2 })
  })

  it('ranks scanned and manual foods from the same history', () => {
    const recent = new Date().toISOString().slice(0, 10)
    const S = { foodEntries: [
      { name: 'Scanned yogurt', date: recent, source: 'open-food-facts' },
      { name: 'Scanned yogurt', date: recent, source: 'open-food-facts' },
      { name: 'Manual soup', date: recent, source: 'manual' },
    ] }
    expect(frequentFoods(S, 2).map(x => x.name)).toEqual(['Scanned yogurt', 'Manual soup'])
  })

  it('ranks the last 30 days by count and adds a banana as one banana', () => {
    const now = new Date(2026, 9, 10, 15, 0, 0).getTime()
    const day = offset => {
      const d = new Date(2026, 9, 10)
      d.setDate(d.getDate() - offset)
      const p = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const foods = frequentFoods({ foodEntries: [
      { name: 'Soup', calories: 100, date: day(40) },
      { name: 'Yogurt', calories: 80, amount: 150, qty: 150, unit: 'g', date: day(2), time: '08:00' },
      { name: 'Yogurt', calories: 100, amount: 200, qty: 200, unit: 'g', date: day(1), time: '08:00' },
      { name: 'Banana', calories: 105, protein: 1.3, amount: 1, qty: 1, unit: 'banana', date: day(1), time: '09:00' },
    ] }, 16, now)
    expect(foods.map(f => f.name)).toEqual(['Yogurt', 'Banana'])
    expect(foods[0].lastAmount).toBe(200)
    expect(makeFoodEntry(foods[1], { amount: foods[1].lastAmount }).calories).toBe(105)
  })

  it('returns at most 16 foods', () => {
    const date = new Date().toISOString().slice(0, 10)
    const foodEntries = Array.from({ length: 20 }, (_, i) => ({ name: `Food ${i}`, calories: 10, date }))
    expect(frequentFoods({ foodEntries })).toHaveLength(16)
  })

  it('learns breakfast only from foods she actually logged', () => {
    const entries = []
    for (let i = 0; i < 5; i++) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      entries.push({ name: 'greek yogurt', date, time: '09:00', protein: 10, calories: 59 })
      entries.push({ name: 'blueberries', date, time: '09:00', protein: 1, calories: 57 })
    }
    const S = { foodEntries: entries }
    expect(learnedBreakfast(S).map(x => x.name).sort()).toEqual(['blueberries', 'greek yogurt'])
    const meal = breakfastEntry(S, { date: '2026-10-08', time: '09:30' })
    expect(meal.components.map(x => x.name).sort()).toEqual(['blueberries', 'greek yogurt'])
    expect(meal.protein).toBe(11)
    expect(meal.calories).toBe(116)
    expect(meal.date).toBe('2026-10-08')
    const withChia = { foodEntries: entries.map(x => ({ ...x })) }
    for (let i = 0; i < 5; i++) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      withChia.foodEntries.push({ name: 'chia seeds', date, time: '09:00', protein: 3, calories: 90, amount: 20, qty: 100 })
    }
    expect(learnedBreakfast(withChia).map(x => x.name)).toContain('chia seeds')
  })

  it('keeps typed totals for the amount and rescales when the amount changes', () => {
    const eggs = entryFromDraft({ name: 'egg', amount: 2, qty: 1, unit: 'egg', protein: 12, calories: 140 })
    expect(eggs).toMatchObject({ protein: 12, calories: 140, amount: 2 })
    expect(perUnitFood(eggs)).toMatchObject({ protein: 6, calories: 70, qty: 1 })
    expect(macrosForAmount(2, { protein: 12, calories: 140 }, 4)).toMatchObject({ protein: 24, calories: 280 })
    const chicken = { name: 'chicken breast', protein: 62, calories: 330, fat: 7.2, carbs: 0, fiber: 0, qty: 100, unit: 'g', amount: 200 }
    const per = perUnitFood(chicken)
    expect(per.protein).toBeCloseTo(31, 5)
    expect(per.calories).toBeCloseTo(165, 5)
    const again = scaledFood({ ...per, lastAmount: 200 }, 200)
    expect(again).toMatchObject({ amount: 200 })
    expect(again.protein).toBeCloseTo(62, 5)
    expect(again.calories).toBeCloseTo(330, 5)
    expect(makeFoodEntry({ name: 'chicken breast', protein: 31, calories: 165, qty: 100, unit: 'g' }, { amount: 200 }).protein).toBeCloseTo(62, 5)
  })

  it('maps an Open Food Facts product and returns null for misses', async () => {
    const item = await lookupBarcode('123456', async () => ({ ok: true, json: async () => ({ product: { product_name: 'Greek Yogurt', brands: "Trader Joe's", nutriments: { proteins_100g: 10, 'energy-kcal_100g': 60, fiber_100g: 0 } } }) }))
    expect(item).toMatchObject({ name: "Greek Yogurt · Trader Joe's", protein: 10, calories: 60, barcode: '123456' })
    expect(await lookupBarcode('123456', async () => ({ ok: true, json: async () => ({ status: 0 }) }))).toBeNull()
  })
})
