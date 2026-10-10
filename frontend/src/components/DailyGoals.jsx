import { useState } from 'react'
import { Button, Section } from './ui.jsx'
import { goalNumber, nutritionGoals, nutritionTargetsFromForm } from '../lib/food.js'

const FIELDS = [
  ['calories', 'Calories'],
  ['protein', 'Protein (g)'],
  ['fiber', 'Fiber (g)'],
  ['fat', 'Fat (g)'],
  ['carbs', 'Carbs (g)'],
]

/** Daily nutrition targets. Empty fat or carbs means no limit. Defaults stay 125 g / 25 g / 1300 kcal. */
export default function DailyGoals({ targets, onSave }) {
  const goals = nutritionGoals(targets)
  const [form, setForm] = useState({
    calories: goals.calories,
    protein: goals.protein,
    fiber: goals.fiber,
    fat: goalNumber(targets?.fat) ?? '',
    carbs: goalNumber(targets?.carbs) ?? '',
  })
  return <Section title="Daily goals" footer="125 g protein, 25 g fiber, and 1300 kcal are the defaults. Leave fat or carbs empty for no limit.">
    <div className="food-goals">
      <div className="food-form-grid">
        {FIELDS.map(([key, label]) => <label key={key}>{label}
          <input type="number" inputMode="decimal" min="0" placeholder={key === 'fat' || key === 'carbs' ? 'No limit' : ''} value={form[key]} onChange={e => setForm(x => ({ ...x, [key]: e.target.value }))} />
        </label>)}
      </div>
      <Button size="sm" variant="primary" onClick={() => onSave(nutritionTargetsFromForm(form))}>Save goals</Button>
    </div>
  </Section>
}
