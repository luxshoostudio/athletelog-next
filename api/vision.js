/* Photo food recognition. The model, its base URL, and the API key stay in the server
   environment (VISION_MODEL, VISION_BASE_URL, VISION_API_KEY) and are never returned to
   the client. The call is an OpenAI-compatible chat completion with an image part. */

const PROMPT = 'Identify every visible food. Estimate the edible portion in grams and the protein, calories, fat, carbs, and fiber for that portion. Reply with JSON only, an array of {"name":"","grams":0,"protein":0,"calories":0,"fat":0,"carbs":0,"fiber":0}. No markdown.'

export function visionConfig(env = process.env) {
  const apiKey = String(env.VISION_API_KEY || '').trim()
  const baseUrl = String(env.VISION_BASE_URL || '').trim().replace(/\/+$/, '')
  const model = String(env.VISION_MODEL || '').trim()
  return { apiKey, baseUrl, model, configured: !!(apiKey && baseUrl && model) }
}

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0
}

const fail = (message, status, code) => Object.assign(new Error(message), { status, code })

/** Pull a food list out of a model reply, including one wrapped in a code fence. */
export function parseVisionFoods(content) {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map(part => part?.text || '').join('') : ''
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw fail('The model did not return any foods.', 502, 'vision-bad-response')
  let rows
  try { rows = JSON.parse(match[0]) } catch { throw fail('The model did not return any foods.', 502, 'vision-bad-response') }
  if (!Array.isArray(rows)) throw fail('The model did not return any foods.', 502, 'vision-bad-response')
  return rows.map(row => ({
    name: String(row?.name || '').trim(),
    grams: num(row?.grams ?? row?.qty ?? row?.amount),
    unit: String(row?.unit || 'g').trim() || 'g',
    protein: num(row?.protein ?? row?.p),
    calories: num(row?.calories ?? row?.kcal),
    fat: num(row?.fat),
    carbs: num(row?.carbs),
    fiber: num(row?.fiber),
  })).filter(row => row.name).slice(0, 20)
}

/**
 * Send one data URL (or raw base64 JPEG) to the configured model.
 * Returns the food list only — never the key, the URL, or the model name.
 */
export async function recognizeFoodPhoto({ image, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = visionConfig(env)
  if (!cfg.configured) throw fail('Photo recognition is not set up on this server.', 503, 'vision-unconfigured')
  if (typeof image !== 'string' || image.length < 32) throw fail('image required', 400, 'image-required')
  const dataUrl = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`
  let res
  try {
    res = await fetchImpl(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ] }],
      }),
    })
  } catch {
    throw fail('The vision model did not answer.', 502, 'vision-bad-response')
  }
  if (!res?.ok) throw fail('The vision model did not answer.', 502, 'vision-bad-response')
  const data = await res.json()
  return parseVisionFoods(data?.choices?.[0]?.message?.content)
}
