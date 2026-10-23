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
 * - Every family is registered under its own name, the fallback families
 *   included: a run the measurer resolved to a fallback is drawn with that
 *   family, and the browser can only draw a family it knows.
 */

import { cssFamilyName } from '../../domain/resume/TextStyle'
import type { FontRegistry } from './FontRegistry'

const registeredFaceKeys = new Set<string>()

export async function registerCanvasFonts(registry: FontRegistry): Promise<void> {
  for (const [family, entry] of registry) {
    await registerFace(family, entry.faces.regular, '400')
    if (entry.faces.bold !== null) {
      await registerFace(family, entry.faces.bold, '700')
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
  // The family is quoted: a name whose last token starts with a digit is not a
  // valid unquoted CSS family name, and the FontFace constructor refuses it.
  const face = new FontFace(cssFamilyName(family), bytes, { weight })
  await face.load()
  document.fonts.add(face)
  registeredFaceKeys.add(key)
}
