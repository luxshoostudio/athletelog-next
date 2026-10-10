// @vitest-environment happy-dom
/* The body-weight card and the gym check-in card are not on Home. Weigh-ins, the goal,
   and the check-in page stay; only these two Home cards are gone. */
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = (showWeightCard, checkIn = true) => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [], bodyweight: [{ d: '2026-10-01', w: 60 }], dayPlan: {}, week: {}, active: null, showWeightCard, checkIn, targetW: 58 },
    user: null,
  }))
  act(() => root.render(<Home />))
}

describe('Home cards Lux asked to hide', () => {
  it('does not show the body-weight card or the check-in card', () => {
    for (const showWeightCard of [undefined, true, false]) {
      mountWith(showWeightCard)
      expect([...host.querySelectorAll('h2')].some(el => el.textContent === 'Body weight')).toBe(false)
      expect(host.textContent).not.toContain('Check in')
      expect(host.textContent).not.toContain('At the gym')
      expect(host.textContent).not.toContain('All weigh-ins')
    }
  })
})
