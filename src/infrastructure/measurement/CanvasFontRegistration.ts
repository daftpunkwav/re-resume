/**
 * @file CanvasFontRegistration
 * @description Registers the registry's font bytes with the document's
 * FontFaceSet, so the canvas draws text with the same faces the canonical
 * measurer measures. Without this, a document family the user's system does
 * not install falls back to a system face and the caret, hit-testing and
 * drawing drift away from the precomputed line breaks.
 *
 * Constraints:
 * - Must complete before the canvas first paints; the composition root awaits
 *   it during startup, which is the only timing guarantee needed because the
 *   canvas mounts after the root resolves.
 * - Idempotent across composition root rebuilds: the provider rebuilds the
 *   root when settings change, and re-adding the same faces would pile up
 *   duplicate FontFace entries in the FontFaceSet.
 */

import type { FontRegistry } from './FontkitTextMeasurer'

const registeredFaceKeys = new Set<string>()

export async function registerCanvasFonts(registry: FontRegistry): Promise<void> {
  for (const [family, faces] of registry) {
    await registerFace(family, faces.regular, '400')
    if (faces.bold !== null) {
      await registerFace(family, faces.bold, '700')
    }
  }
}

async function registerFace(
  family: string,
  bytes: Uint8Array<ArrayBuffer>,
  weight: string,
): Promise<void> {
  const key = `${family}/${weight}`
  if (registeredFaceKeys.has(key)) return
  const face = new FontFace(family, bytes, { weight })
  await face.load()
  document.fonts.add(face)
  registeredFaceKeys.add(key)
}
