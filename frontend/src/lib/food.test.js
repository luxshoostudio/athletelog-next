import { describe, expect, it } from 'vitest'
import { breakfastEntry, entryFromDraft, foodSearch, frequentFoods, learnedBreakfast, lookupBarcode, macrosForAmount, makeFoodEntry, perUnitFood, scaledFood, totalsForDay } from './food.js'

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
