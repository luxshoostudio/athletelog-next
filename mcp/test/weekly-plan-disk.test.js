import { test, expect, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dirs = []
afterAll(() => { dirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })) })

test('set_weekly_plan writes the profile file the api server reads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-plan-'))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [{ id: 'lux', name: 'Lux', created: '2026-01-01' }], creds: [], subs: [], invites: [],
  }))
  fs.writeFileSync(path.join(dir, 'state-lux.json'), JSON.stringify({
    routines: [{ id: 'push', name: 'Push', ex: [{ id: 'bench' }] }],
    week: { 1: 'push' },
    nutritionTargets: { calories: 1300, protein: 100, fiber: 20 },
    workouts: [{ id: 'logged' }],
  }))
  vi.resetModules()
  vi.stubEnv('OPENGYM_DATA', dir)
  vi.stubEnv('OPENGYM_UID', 'lux')
  const { setWeeklyPlan } = await import('../src/weekly-plan.js')
  const written = setWeeklyPlan.handler({
    protein_g: 125,
    fiber_g: 25,
    days: [
      { weekday_name: 'Monday', workout: { type: 'strength', name: 'Upper strength', detail: 'Upper' } },
      { weekday_name: 'Sunday', workout: { type: 'rest', name: 'Rest', detail: 'Rest' } },
    ],
  })
  expect(written.updated_by).toBe('livy')
  expect(written.days.find(day => day.weekday === 0).workout).toBeNull()
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state-lux.json'), 'utf8'))
  expect(saved.mealPlan.protein).toBe(125)
  expect(saved.mealPlan.updatedBy).toBe('livy')
  expect(saved.routines.map(item => item.id)).toEqual(['push'])
  expect(saved.routines[0]).toMatchObject({ name: 'Upper strength', ex: [{ id: 'bench' }] })
  expect(saved.week[1] ?? saved.week['1']).toBe('push')
  expect(saved.week[0] ?? saved.week['0']).toBeUndefined()
  expect(saved.nutritionTargets).toEqual({ calories: 1300, protein: 125, fiber: 25 })
  expect(saved.workouts.map(item => item.id)).toEqual(['logged'])
  vi.unstubAllEnvs()
})
