// Forest palette: the light and dark tokens in index.css, the default for a new profile,
// and the contrast those pairs actually have. WCAG AA — 4.5:1 for text, 3:1 for the
// protein bar and other non-text UI.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_INK, ACCENTS } from './format.js'
import { DEFAULT_ACCENT, THEMES, contrast } from './accent.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'index.css'), 'utf8')
const store = readFileSync(join(root, 'store/useStore.js'), 'utf8')
const settings = readFileSync(join(root, 'views/Settings.jsx'), 'utf8')
const html = readFileSync(join(root, '../index.html'), 'utf8')

function hexVars(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = css.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'))?.[1]
  expect(body, selector).toBeTruthy()
  const out = {}
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toLowerCase()
  return out
}

describe('Forest theme tokens', () => {
  const dark = hexVars(':root')
  const light = hexVars(':root[data-theme="light"]')

  it('paints the light page, cards, text, buttons and protein in Forest', () => {
    expect(light.bg).toBe('#f7f5ef')
    expect(light.surface).toBe('#ffffff')
    expect(light.label).toBe('#1f2a24')
    expect(light.btn).toBe('#2f5d50')
    expect(light['btn-ink']).toBe('#ffffff')
    expect(light.protein).toBe('#e07a2f')
    expect(light.acc).toBe('#2f5d50')
  })

  it('gives dark mode a green-black page, a lighter green and the lighter orange', () => {
    expect(dark.bg).toBe('#121a16')
    expect(dark.surface).toBe('#1c2621')
    expect(dark.btn).toBe('#6fa58f')
    expect(dark['btn-ink']).toBe('#10201a')
    expect(dark.protein).toBe('#f0a060')
    expect(dark.acc).toBe('#6fa58f')
  })

  it('keeps text at 4.5:1 and the protein bar at 3:1', () => {
    for (const [fg, bg] of [
      [light.label, light.bg], [light.label, light.surface],
      [light['label-2'], light.bg], [light['label-2'], light.surface],
      [light['label-3'], light.bg], [light['label-3'], light.surface],
      [light['btn-ink'], light.btn], [light['btn-ink'], light['btn-pressed']],
      [dark.label, dark.bg], [dark.label, dark.surface],
      [dark['label-2'], dark.bg], [dark['label-2'], dark.surface],
      [dark['label-3'], dark.bg], [dark['label-3'], dark.surface],
      [dark['btn-ink'], dark.btn], [dark['btn-ink'], dark['btn-pressed']],
      [dark.btn, dark.bg], [dark.btn, dark.surface],
      [light.btn, light.bg], [light.btn, light.surface],
    ]) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    // The orange number stays the body colour; the bar sits on a white track in light mode.
    expect(css).toContain(':root[data-theme="light"] .food-progress { background:#ffffff;')
    expect(css).not.toContain('.food-macro.protein b')
    expect(contrast(light.protein, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast(dark.protein, dark['surface-3'])).toBeGreaterThanOrEqual(3)
    expect(contrast(light.line, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast(dark.line, dark.bg)).toBeGreaterThanOrEqual(3)
    expect(contrast(dark.line, dark.surface)).toBeGreaterThanOrEqual(3)
  })

  it('uses the green for primary buttons, calorie and fiber bars, and the active tab', () => {
    expect(css).toContain('.btn.primary{background:var(--btn);color:var(--btn-ink)}')
    expect(css).toContain('.food-macro.cal .food-progress i,.food-macro.fiber .food-progress i { background:var(--btn); }')
    expect(css).toContain('#tabbar button.on{color:var(--btn)}')
  })

  it('defaults a new profile to light Forest and does not rewrite a stored theme', () => {
    expect(DEFAULT_ACCENT).toBe('forest')
    expect(ACCENTS.forest).toBe('#2f5d50')
    expect(ACCENT_INK.forest).toBe('#ffffff')
    expect(THEMES.light.bgs).toEqual(['#f7f5ef', '#ffffff'])
    expect(THEMES.dark.bgs).toEqual(['#121a16', '#1c2621'])
    expect(store).toContain("theme: 'light', accent: 'forest'")
    expect(settings).toContain("S.theme || 'light'")
    expect(settings).not.toContain("S.theme || 'dark'")
    expect(html).toContain('content="#f7f5ef"')
    expect(html).toContain("document.documentElement.dataset.theme = theme")
  })
})
