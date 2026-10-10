import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import {
  breakfastEntry, entryFromDraft, foodDay, foodSearch, foodTime, frequentFoods, goalNumber, goalSuffix,
  learnedBreakfast, lookupBarcode, macroIsLimit, macrosForAmount, nutritionGoals,
  nutritionTargetsFromForm, perUnitFood, scaledFood, totalsForDay,
} from '../lib/food.js'
import { athleteLogImport, mergeAthleteLogImport } from '../lib/import-athletelog.js'

const round = value => Math.round((Number(value) || 0) * 10) / 10
const newDraft = (date = foodDay()) => ({ name: '', amount: 1, unit: 'serving', protein: '', calories: '', fiber: '', fat: '', carbs: '', date, time: foodTime() })

function Macro({ label, value, goal, unit, tone }) {
  const key = tone === 'cal' ? 'calories' : tone
  const limit = macroIsLimit(key) ? goalNumber(goal) : null
  const pct = limit ? Math.min(100, (Number(value) || 0) / limit * 100) : 0
  return <div className={`food-macro ${tone}`}>
    <div className="row between"><span className="lbl2">{label}</span><span><b>{round(value)}</b> <span className="dim">{goalSuffix(key, { [key]: limit }, unit)}</span></span></div>
    {limit ? <div className="food-progress"><i style={{ width: `${pct}%` }} /></div> : null}
  </div>
}

const MACRO_FIELDS = ['calories', 'protein', 'fiber', 'fat', 'carbs']

function DailyGoals({ targets, onSave }) {
  const goals = nutritionGoals(targets)
  const [form, setForm] = useState({
    calories: goals.calories,
    protein: goals.protein,
    fiber: goals.fiber,
    fat: goalNumber(targets?.fat) ?? '',
    carbs: goalNumber(targets?.carbs) ?? '',
  })
  const set = key => e => setForm(x => ({ ...x, [key]: e.target.value }))
  return <div className="card">
    <h2>Daily goals</h2>
    <div className="food-form-grid">
      <label>Calories<input type="number" inputMode="decimal" min="0" value={form.calories} onChange={set('calories')} /></label>
      <label>Protein (g)<input type="number" inputMode="decimal" min="0" value={form.protein} onChange={set('protein')} /></label>
      <label>Fiber (g)<input type="number" inputMode="decimal" min="0" value={form.fiber} onChange={set('fiber')} /></label>
      <label>Fat (g)<input type="number" inputMode="decimal" min="0" placeholder="No limit" value={form.fat} onChange={set('fat')} /></label>
      <label>Carbs (g)<input type="number" inputMode="decimal" min="0" placeholder="No limit" value={form.carbs} onChange={set('carbs')} /></label>
    </div>
    <Button size="sm" variant="primary" onClick={() => onSave(nutritionTargetsFromForm(form))}>Save goals</Button>
  </div>
}

function EntryEditor({ entry, onSave, onClose }) {
  // Macros on screen are the totals for the amount. Amount edits scale from the portion those
  // numbers belonged to, not from the previous keystroke, and Save stores that total as-is.
  const base = useRef({
    amount: Number(entry.amount) || Number(entry.qty) || 1,
    macros: Object.fromEntries(MACRO_FIELDS.map(k => [k, entry[k] ?? ''])),
  })
  const [draft, setDraft] = useState({ ...entry })
  const field = key => ({ value: draft[key] ?? '', onChange: e => setDraft(x => ({ ...x, [key]: e.target.value })) })
  const setMacro = (key, value) => setDraft(x => {
    const amount = Number(x.amount) || base.current.amount || 1
    base.current = { amount, macros: { ...Object.fromEntries(MACRO_FIELDS.map(k => [k, x[k] ?? ''])), [key]: value } }
    return { ...x, [key]: value }
  })
  const setAmount = value => setDraft(x => ({ ...x, amount: value, ...macrosForAmount(base.current.amount, base.current.macros, value) }))
  const save = () => {
    if (!draft.name.trim()) return
    const amount = Number(draft.amount) || base.current.amount || 1
    const macros = macrosForAmount(base.current.amount, base.current.macros, amount)
    onSave({ ...draft, amount, ...Object.fromEntries(MACRO_FIELDS.map(k => [k, Number(macros[k]) || 0])) })
  }
  return <div className="card food-editor">
    <div className="row between"><h2>{entry.id ? 'Edit food' : 'Add food'}</h2><button className="iconbtn" onClick={onClose}><Icon name="xmark" /></button></div>
    <label>Name<input {...field('name')} autoFocus /></label>
    <div className="food-form-grid">
      <label>Amount<input type="number" inputMode="decimal" value={draft.amount ?? ''} onChange={e => setAmount(e.target.value)} /></label>
      <label>Unit<input {...field('unit')} /></label>
      <label>Calories<input type="number" inputMode="decimal" value={draft.calories ?? ''} onChange={e => setMacro('calories', e.target.value)} /></label>
      <label>Protein (g)<input type="number" inputMode="decimal" value={draft.protein ?? ''} onChange={e => setMacro('protein', e.target.value)} /></label>
      <label>Fiber (g)<input type="number" inputMode="decimal" value={draft.fiber ?? ''} onChange={e => setMacro('fiber', e.target.value)} /></label>
      <label>Fat (g)<input type="number" inputMode="decimal" value={draft.fat ?? ''} onChange={e => setMacro('fat', e.target.value)} /></label>
      <label>Carbs (g)<input type="number" inputMode="decimal" value={draft.carbs ?? ''} onChange={e => setMacro('carbs', e.target.value)} /></label>
      <label>Date<input type="date" {...field('date')} /></label>
      <label>Time<input type="time" {...field('time')} /></label>
    </div>
    <Button variant="primary" onClick={save}>Save</Button>
  </div>
}

export default function Food() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [day, setDay] = useState(foodDay())
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [scan, setScan] = useState(false)
  const [barcode, setBarcode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const targets = nutritionGoals(S.nutritionTargets)
  const totals = totalsForDay(S.foodEntries, day)
  const entries = (S.foodEntries || []).filter(x => x.date === day).sort((a, b) => String(b.time).localeCompare(String(a.time)))
  const results = useMemo(() => query.trim() ? foodSearch(S, query) : [], [S, query])
  const frequent = frequentFoods(S, 8)
  const breakfast = learnedBreakfast(S)

  const commit = draft => {
    update(state => {
      const saved = entryFromDraft(draft)
      state.foodEntries ||= []
      if (draft.id) state.foodEntries = state.foodEntries.map(x => x.id === draft.id ? saved : x)
      else state.foodEntries.push(saved)
      state.foodItems ||= {}
      state.foodItems[saved.name.toLocaleLowerCase()] = perUnitFood(saved)
    })
    setEditing(null); setQuery('')
  }
  const quickAdd = item => {
    const per = perUnitFood(item)
    const amount = Number(item.lastAmount) || per.qty || 1
    setEditing({ ...scaledFood(per, amount), qty: per.qty, unit: per.unit, date: day, time: foodTime() })
  }
  const remove = id => update(state => { state.foodEntries = (state.foodEntries || []).filter(x => x.id !== id) })
  const toggleFav = name => update(state => {
    const key = name.toLocaleLowerCase(); state.favoriteFoods ||= []
    state.favoriteFoods = state.favoriteFoods.includes(key) ? state.favoriteFoods.filter(x => x !== key) : [...state.favoriteFoods, key]
  })
  const addBreakfast = () => {
    const entry = breakfastEntry(S, { date: day, time: foodTime() })
    if (!entry) { setMessage('Add breakfast on at least three mornings so AthleteLog can learn the bundle.'); return }
    update(state => { state.foodEntries ||= []; state.foodEntries.push(entry) })
  }
  const lookup = async () => {
    setBusy(true); setMessage('')
    try {
      const item = await lookupBarcode(barcode)
      if (item) { setEditing({ ...item, amount: item.qty, date: day, time: foodTime() }); setScan(false) }
      else { setEditing({ ...newDraft(day), name: `Barcode ${barcode}`, barcode, source: 'manual-barcode' }); setScan(false); setMessage('No product found. Add the label values once and it will stay in your food bank.') }
    } catch (e) { setMessage(e.message || 'Could not scan this product.') }
    finally { setBusy(false) }
  }
  const importAthleteLog = async event => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const imported = athleteLogImport(parsed, S)
      if (imported.duplicate) { setMessage('This AthleteLog backup was already imported.'); return }
      update(state => mergeAthleteLogImport(state, imported))
      setMessage(`Imported ${imported.workouts.length} workouts and ${imported.foodEntries.length} food entries.`)
    } catch (e) { setMessage(e.message || 'This file could not be imported.') }
  }

  return <div className="narrow food-page">
    <div className="hdr"><div><h1>Food</h1><div className="sub">Local nutrition log</div></div><div className="row" style={{ gap: 7 }}><button className="iconbtn" onClick={() => importRef.current?.click()} aria-label="Import AthleteLog"><Icon name="download" /></button><button className="iconbtn" onClick={() => nav('/home')}><Icon name="house" /></button></div></div>
    <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={importAthleteLog} />
    <div className="card food-summary">
      <input className="food-date" type="date" value={day} onChange={e => setDay(e.target.value)} />
      <Macro tone="cal" label="Calories" value={totals.calories} goal={targets.calories} unit="kcal" />
      <Macro tone="protein" label="Protein" value={totals.protein} goal={targets.protein} unit="g" />
      <Macro tone="fiber" label="Fiber" value={totals.fiber} goal={targets.fiber} unit="g" />
      <Macro tone="fat" label="Fat" value={totals.fat} goal={targets.fat} unit="g" />
      <Macro tone="carbs" label="Carbs" value={totals.carbs} goal={targets.carbs} unit="g" />
    </div>
    <DailyGoals key={JSON.stringify(S.nutritionTargets || {})} targets={S.nutritionTargets} onSave={next => update(state => { state.nutritionTargets = next })} />

    <div className="card">
      <div className="food-search-row">
        <Icon name="magnifier" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search or add food" />
        <button className="iconbtn" onClick={() => setEditing(newDraft(day))} aria-label="Add custom food"><Icon name="plus" /></button>
        <button className="iconbtn" onClick={() => setScan(x => !x)} aria-label="Scan barcode"><Icon name="qr" /></button>
      </div>
      {scan && <div className="food-scan">
        <input inputMode="numeric" value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Enter barcode number" />
        <Button size="sm" variant="primary" onClick={lookup} disabled={busy}>{busy ? 'Looking up…' : 'Look up'}</Button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden />
      </div>}
      {!!query && <div className="food-results">{results.map(item => <button key={item.name} onClick={() => quickAdd(item)}><span>{item.name}</span><span className="dim">{round(item.protein)}g P · {round(item.calories)} kcal</span></button>)}</div>}
      {!!query && !results.length && <button className="food-empty-add" onClick={() => setEditing({ ...newDraft(day), name: query })}>Create “{query}”</button>}
      {message && <p className="small" style={{ color: 'var(--orange)' }}>{message}</p>}
    </div>

    {editing && <EntryEditor entry={editing} onSave={commit} onClose={() => setEditing(null)} />}

    <div className="card">
      <div className="row between"><h2>Quick add</h2>{breakfast.length >= 2 && <Button size="sm" variant="tinted" onClick={addBreakfast}>Usual Breakfast</Button>}</div>
      <div className="food-chips">{frequent.map(item => <button key={item.name} onClick={() => quickAdd(item)}>{item.name}</button>)}</div>
      {breakfast.length >= 2 && <div className="small dim food-breakfast-list">Breakfast: {breakfast.map(x => x.name).join(' · ')}</div>}
      {!frequent.length && <div className="muted small">Foods you log become quick options here.</div>}
    </div>

    <h2 className="sec">{day === foodDay() ? 'Today' : day}</h2>
    <div className="food-log">{entries.map(entry => {
      const fav = (S.favoriteFoods || []).includes(entry.name.toLocaleLowerCase())
      return <div className="card food-entry" key={entry.id}>
        <button className="food-entry-main" onClick={() => setEditing(entry)}>
          <span className="dim food-time">{entry.time}</span><b>{entry.name}</b>
          <span className="dim">{round(entry.protein)}g P · {round(entry.calories)} kcal</span>
        </button>
        <button className="iconbtn" onClick={() => toggleFav(entry.name)} aria-label="Favourite"><Icon name={fav ? 'starFill' : 'star'} /></button>
        <button className="iconbtn" onClick={() => remove(entry.id)} aria-label="Delete"><Icon name="xmark" /></button>
      </div>
    })}{!entries.length && <div className="empty">No food logged for this day.</div>}</div>
  </div>
}
