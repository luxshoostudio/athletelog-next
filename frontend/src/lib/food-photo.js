import { api } from './api.js'

export const PHOTO_MAX_PX = 1024

/** Longest side down to 1024px, never scaled up. */
export function photoScale(width, height, maxPx = PHOTO_MAX_PX) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  const longest = Math.max(w, h)
  if (!(longest > 0)) return { width: 1, height: 1, scale: 1 }
  const scale = Math.min(1, maxPx / longest)
  return { scale, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

export function resizeFoodPhoto(file, maxPx = PHOTO_MAX_PX) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { width, height } = photoScale(img.naturalWidth || img.width, img.naturalHeight || img.height, maxPx)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Could not read that photo')); return }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not read that photo')), 'image/jpeg', 0.82)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo')) }
    img.src = url
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read that photo'))
    reader.readAsDataURL(blob)
  })
}

export function photoErrorMessage(err) {
  const code = err?.data?.code || err?.code
  if (err?.status === 401) return 'Sign in to recognize a photo.'
  if (!err?.status || code === 'vision-unconfigured' || code === 'timeout' || code === 'not-paired')
    return 'Photo recognition is not set up on this server.'
  return err?.message || 'Could not read that photo.'
}

const round1 = n => Math.round((Number(n) || 0) * 10) / 10

/** Items the review sheet edits. Grams scale the model's macros from the original estimate. */
export function reviewItems(items) {
  return (items || []).map(item => {
    const grams = Number(item?.grams ?? item?.qty) || 0
    const base = {
      protein: round1(item?.protein),
      calories: Math.round(Number(item?.calories) || 0),
      fat: round1(item?.fat),
      carbs: round1(item?.carbs),
      fiber: round1(item?.fiber),
    }
    return { name: String(item?.name || '').trim(), grams, unit: item?.unit || 'g', baseGrams: grams || 1, base, ...base }
  }).filter(item => item.name)
}

export function withGrams(item, grams) {
  const next = Number(grams)
  const factor = (Number.isFinite(next) ? next : 0) / (item.baseGrams || 1)
  const scaled = {
    protein: round1(item.base.protein * factor),
    calories: Math.round(item.base.calories * factor),
    fat: round1(item.base.fat * factor),
    carbs: round1(item.base.carbs * factor),
    fiber: round1(item.base.fiber * factor),
  }
  return { ...item, grams: Number.isFinite(next) ? next : '', ...scaled }
}

/** Ask the server whether a key is configured. The key itself never comes back. */
export async function photoConfigured() {
  const status = await api('/api/food/photo')
  return !!status?.configured
}

export async function sendFoodPhoto(file) {
  const blob = await resizeFoodPhoto(file)
  const image = await blobToDataUrl(blob)
  const res = await api('/api/food/photo', { method: 'POST', body: JSON.stringify({ image }), timeout: 90000 })
  return reviewItems(res?.items)
}
