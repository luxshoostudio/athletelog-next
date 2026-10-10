// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const inboxItem = entry => ({ id: entry.id, kind: 'food', entry, at: 1 })

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('food changes sync on the existing debounce', () => {
  it('pushes a food add, and the body still has that entry', async () => {
    vi.useFakeTimers()
    const S = { ...clone(DEF), _ts: 100, foodEntries: [] }
    useStore.setState({ S, user: { id: 'user-1' }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 3, ts: 100 }))
    api.mockResolvedValue({ ok: true, rev: 4, wid: 'ab' })

    useStore.getState().update(state => {
      state.foodEntries.push({ id: 'f1', name: 'oats', date: '2026-10-10', time: '08:00', calories: 100, protein: 5, source: 'manual' })
    })
    expect(puts()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(puts()).toHaveLength(1)
    expect(puts()[0].state.foodEntries.map(e => e.id)).toEqual(['f1'])
    expect(puts()[0].state.edited.foodEntries).toBeGreaterThan(0)
  })
})

describe('Livy inbox apply', () => {
  const entry = {
    id: 'livy-oats', name: 'oats', amount: 40, qty: 40, unit: 'g',
    calories: 150, protein: 5, fat: 0, carbs: 0, fiber: 0,
    date: '2026-10-10', time: '08:00', createdAt: 1, source: 'livy',
  }

  it('appends inbox entries that arrived with a pull and does not replace the ones already logged', async () => {
    vi.useFakeTimers()
    const local = { ...clone(DEF), _ts: 100, foodEntries: [{ id: 'mine', name: 'egg', calories: 70, source: 'manual' }], workouts: [] }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({
      state: { ...clone(DEF), _ts: 100, foodEntries: [{ id: 'mine', name: 'egg', calories: 70, source: 'manual' }], _rev: 1 },
      rev: 1,
      inbox: [inboxItem(entry)],
    })
    api.mockResolvedValue({ ok: true, rev: 2, wid: 'ab', removed: ['livy-oats'] })

    await useStore.getState().pullState()
    await vi.advanceTimersByTimeAsync(1500)

    const ids = useStore.getState().S.foodEntries.map(e => e.id)
    expect(ids).toEqual(['mine', 'livy-oats'])
    expect(useStore.getState().S.foodEntries[0]).toMatchObject({ name: 'egg', calories: 70 })
    expect(useStore.getState().S.foodEntries[1].source).toBe('livy')
    expect(puts().some(body => body.state.foodEntries.some(e => e.id === 'livy-oats'))).toBe(true)
  })

  it('reads the inbox when the revision did not move but livy entries are waiting', async () => {
    const local = { ...clone(DEF), _ts: 100, foodEntries: [], workouts: [] }
    useStore.setState({ S: local, user: { id: 'user-1' }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockImplementation(async (path) => {
      if (path === '/api/data/rev') return { rev: 1, livy: 1 }
      if (path === '/api/livy/inbox') return { items: [inboxItem(entry)] }
      if (path === '/api/livy/inbox/ack') return { ok: true, removed: ['livy-oats'] }
      return { ok: true, rev: 2 }
    })

    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(useStore.getState().S.foodEntries.map(e => e.id)).toEqual(['livy-oats']))
    expect(useStore.getState().undoLivyNotice().removed.map(x => x.id)).toEqual(['livy-oats'])
    expect(useStore.getState().S.foodEntries).toEqual([])
    // The undo is an ordinary save: it goes out on the same debounce as a hand-logged delete.
    await new Promise(r => setTimeout(r, 1700))
    expect(puts().at(-1).state.foodEntries).toEqual([])
  })
})
