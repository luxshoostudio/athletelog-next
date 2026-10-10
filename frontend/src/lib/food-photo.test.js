import { describe, expect, it } from 'vitest'
import { photoErrorMessage, photoScale, reviewItems, withGrams } from './food-photo.js'

describe('photoScale', () => {
  it('shrinks the long side to 1024 and leaves a smaller photo alone', () => {
    expect(photoScale(3000, 2000)).toEqual({ scale: 1024 / 3000, width: 1024, height: 683 })
    expect(photoScale(800, 600)).toEqual({ scale: 1, width: 800, height: 600 })
  })
})

describe('review items', () => {
  it('keeps a banana at its estimated calories and scales when the grams change', () => {
    const [banana] = reviewItems([{ name: 'banana', grams: 118, protein: 1.3, calories: 105, fat: 0.4, carbs: 27, fiber: 3.1 }])
    expect(banana.calories).toBe(105)
    const half = withGrams(banana, 59)
    expect(half.grams).toBe(59)
    expect(half.calories).toBe(53)
    expect(half.protein).toBeCloseTo(0.7, 1)
  })
})

describe('photoErrorMessage', () => {
  it('says when the server has no vision key, and when nobody is signed in', () => {
    expect(photoErrorMessage({ status: 503, data: { code: 'vision-unconfigured' } })).toBe('Photo recognition is not set up on this server.')
    expect(photoErrorMessage(new TypeError('Failed to fetch'))).toBe('Photo recognition is not set up on this server.')
    expect(photoErrorMessage({ status: 401, message: 'not signed in' })).toBe('Sign in to recognize a photo.')
  })
})
