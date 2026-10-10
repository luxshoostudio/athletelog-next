import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVisionFoods, recognizeFoodPhoto, visionConfig } from '../vision.js'

const env = { VISION_API_KEY: 'sk-test-secret', VISION_BASE_URL: 'https://vision.example/v1/', VISION_MODEL: 'gpt-test' }
const image = 'data:image/jpeg;base64,' + 'a'.repeat(40)

test('vision is unconfigured until key, base URL, and model are all set', () => {
  assert.equal(visionConfig({}).configured, false)
  assert.equal(visionConfig({ VISION_API_KEY: 'k', VISION_BASE_URL: 'https://x', VISION_MODEL: '' }).configured, false)
  assert.equal(visionConfig(env).configured, true)
})

test('a mocked model returns foods and the key never leaves the server', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({ choices: [{ message: { content: '```json\n[{"name":"banana","grams":118,"protein":1.3,"calories":105,"fat":0.4,"carbs":27,"fiber":3.1}]\n```' } }] }) }
  }
  const items = await recognizeFoodPhoto({ image, env, fetchImpl })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://vision.example/v1/chat/completions')
  assert.equal(calls[0].auth, 'Bearer sk-test-secret')
  assert.equal(calls[0].body.model, 'gpt-test')
  assert.equal(calls[0].body.messages[0].content[1].image_url.url, image)
  assert.deepEqual(items, [{ name: 'banana', grams: 118, unit: 'g', protein: 1.3, calories: 105, fat: 0.4, carbs: 27, fiber: 3.1 }])
  assert.equal(JSON.stringify(items).includes('sk-test-secret'), false)
  assert.equal(JSON.stringify(items).includes('vision.example'), false)
})

test('no key refuses before any model call', async () => {
  let called = false
  await assert.rejects(
    () => recognizeFoodPhoto({ image, env: {}, fetchImpl: () => { called = true } }),
    err => err.code === 'vision-unconfigured' && err.status === 503,
  )
  assert.equal(called, false)
})

test('a model that answers with prose is a bad response, not a crash', () => {
  assert.throws(() => parseVisionFoods('I see a banana.'), err => err.code === 'vision-bad-response')
})

test('a failed model request does not leak the key', async () => {
  await assert.rejects(
    () => recognizeFoodPhoto({ image, env, fetchImpl: async () => { throw new Error('sk-test-secret refused') } }),
    err => err.code === 'vision-bad-response' && !String(err.message).includes('sk-test-secret'),
  )
})
