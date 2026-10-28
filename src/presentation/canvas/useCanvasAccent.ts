/**
 * @file useCanvasAccent
 * @description Reads the interface accent once per canvas mount. Konva cannot
 * resolve CSS custom properties, so the selection colour is sampled from the
 * document root and kept until the canvas remounts.
 */

import { useState } from 'react'

import { SELECTION_FALLBACK } from './canvasStyle'

function readAccent(): string {
  if (typeof document === 'undefined') return SELECTION_FALLBACK
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return value === '' ? SELECTION_FALLBACK : value
}

export function useCanvasAccent(): string {
  const [accent] = useState(readAccent)
  return accent
}
