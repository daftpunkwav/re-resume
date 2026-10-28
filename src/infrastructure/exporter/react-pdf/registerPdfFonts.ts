/**
 * @file registerPdfFonts
 * @description Registers the FontRegistry's families with the PDF renderer's
 * font store, once per registry per session.
 *
 * Responsibilities:
 * - Bind every family the registry carries to its faces under the same family
 *   name the measurer and the canvas use
 * - Convert face bytes to the data URLs the renderer's font loader consumes
 *
 * Constraints:
 * - Registration is idempotent: families the store already carries are left
 *   alone, so repeated exports do not re-encode the faces.
 * - A family the renderer cannot be given is an error, not a fallback: a
 *   missing face would silently move glyphs to a substitute font and the drawn
 *   advances away from the measured ones.
 */

import { Font } from '@react-pdf/renderer'

import type { FontFamily, FontRegistry } from '../../measurement/FontRegistry'

/**
 * The weight the renderer matches a bold run's face by. The registry resolves
 * faces at weights 400 and 700 only, so one bold source per family is the whole
 * mapping.
 */
const BOLD_REGISTRATION_WEIGHT = 700

/**
 * The MIME type of a data URL carrying opaque font bytes; the loader only
 * decodes the base64 payload, so the exact font format is not named.
 */
const FONT_BYTES_MIME = 'application/octet-stream'

const BASE64_CHUNK = 0x8000

/** Registers every family of the registry that the renderer does not hold yet. */
export async function registerPdfFonts(registry: FontRegistry): Promise<void> {
  for (const [family, entry] of registry) {
    if (isRegistered(family)) continue
    Font.register({ family, fonts: fontSources(entry) })
  }
}

function isRegistered(family: string): boolean {
  return Object.prototype.hasOwnProperty.call(Font.getRegisteredFonts(), family)
}

/** One face entry the renderer's font store accepts. */
interface PdfFontSource {
  readonly src: string
  readonly fontWeight?: number
}

function fontSources(entry: FontFamily): PdfFontSource[] {
  const sources: PdfFontSource[] = [{ src: asDataUrl(entry.faces.regular) }]
  if (entry.faces.bold !== null) {
    sources.push({ src: asDataUrl(entry.faces.bold), fontWeight: BOLD_REGISTRATION_WEIGHT })
  }
  return sources
}

/**
 * Base64 in browser and Node: `btoa` exists in both, and the byte string is
 * built in chunks because spreading font-sized arrays into one
 * `String.fromCharCode` call overflows the argument limit.
 */
function asDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))
  }
  return `data:${FONT_BYTES_MIME};base64,${btoa(binary)}`
}
