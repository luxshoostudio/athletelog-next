import { describe, expect, it } from 'vitest'
import { breakfastEntry, foodSearch, frequentFoods, learnedBreakfast, lookupBarcode, makeFoodEntry, totalsForDay } from './food.js'

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

  it('learns breakfast and always includes chia seeds', () => {
    const entries = []
    for (let i = 0; i < 5; i++) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      entries.push({ name: 'greek yogurt', date, time: '09:00', protein: 10, calories: 59 })
      entries.push({ name: 'blueberries', date, time: '09:00', protein: 1, calories: 57 })
    }
    const S = { foodEntries: entries }
    expect(learnedBreakfast(S).map(x => x.name)).toEqual(expect.arrayContaining(['greek yogurt', 'blueberries', 'chia seeds']))
    const meal = breakfastEntry(S, { date: '2026-10-08', time: '09:30' })
    expect(meal.components.length).toBeGreaterThanOrEqual(3)
    expect(meal.date).toBe('2026-10-08')
  })

  it('maps an Open Food Facts product and returns null for misses', async () => {
    const item = await lookupBarcode('123456', async () => ({ ok: true, json: async () => ({ product: { product_name: 'Greek Yogurt', brands: "Trader Joe's", nutriments: { proteins_100g: 10, 'energy-kcal_100g': 60, fiber_100g: 0 } } }) }))
    expect(item).toMatchObject({ name: "Greek Yogurt · Trader Joe's", protein: 10, calories: 60, barcode: '123456' })
    expect(await lookupBarcode('123456', async () => ({ ok: true, json: async () => ({ status: 0 }) }))).toBeNull()
  })
})
