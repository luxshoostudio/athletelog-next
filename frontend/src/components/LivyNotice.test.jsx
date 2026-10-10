// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LivyNotice from './LivyNotice.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  ready: true,
  S: { foodEntries: [], workouts: [] },
  dismissLivyNotice: vi.fn(),
  undoLivyNotice: vi.fn(),
}))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks)
  return { useStore }
})

function render() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => { root.render(<LivyNotice />) })
  return {
    el,
    unmount() { act(() => root.unmount()); el.remove() },
  }
}

beforeEach(() => {
  mocks.ready = true
  mocks.S = { foodEntries: [], workouts: [] }
  mocks.dismissLivyNotice.mockReset()
  mocks.undoLivyNotice.mockReset()
})

describe('LivyNotice', () => {
  it('says how many entries Livy added and undo calls the store', () => {
    mocks.S = {
      foodEntries: [{ id: 'a', source: 'livy' }, { id: 'b', source: 'manual' }],
      workouts: [{ id: 'c', source: 'livy' }],
    }
    const view = render()
    expect(view.el.textContent).toContain('2 entries added by Livy')
    view.el.querySelector('.livy-note-undo').click()
    expect(mocks.undoLivyNotice).toHaveBeenCalledTimes(1)
    view.el.querySelector('[aria-label="Dismiss"]').click()
    expect(mocks.dismissLivyNotice).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('stays quiet when every Livy entry was already dismissed', () => {
    mocks.S = { foodEntries: [{ id: 'a', source: 'livy' }], workouts: [], livyNotified: ['a'] }
    const view = render()
    expect(view.el.textContent).toBe('')
    view.unmount()
  })
})
