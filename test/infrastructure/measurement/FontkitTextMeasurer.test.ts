// @vitest-environment node
/**
 * @file FontkitTextMeasurer.test
 * @description The canonical measurer against the real bundled faces. Running
 * in node because the fonts are read from the repository and fontkit never
 * touches a browser API; the widths these tests pin are the same numbers
 * pagination, overflow checks and later the exporters consume on both
 * platforms.
 *
 * The fixtures are exact numbers where the font guarantees them — a Han
 * ideograph in Noto Sans SC advances exactly one em — and relational where
 * they do not (bold wider than regular), so the suite survives a font update
 * without asserting someone else's glyph table.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { layout } from '../../../src/application/layout/layout'
import {
  MissingFontFamilyError,
  createFontkitTextMeasurer,
} from '../../../src/infrastructure/measurement/FontkitTextMeasurer'
import type { FontFaces, FontRegistry } from '../../../src/infrastructure/measurement/FontkitTextMeasurer'
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_STYLE } from '../../../src/domain/resume/TextStyle'
import type { TextStyle } from '../../../src/domain/resume/TextStyle'
import type { MaterializedBlock } from '../../../src/domain/resume/ResumeSnapshot'
import { asBlockId } from '../../../src/domain/shared/branded-id'

const fontDirectory = fileURLToPath(new URL('../../../src/assets/fonts/', import.meta.url))

function faceBytes(file: string): Uint8Array<ArrayBuffer> {
  // A copy into a fresh ArrayBuffer, which is the shape both fontkit's
  // browser build and the FontFace constructor consume.
  return new Uint8Array(readFileSync(`${fontDirectory}${file}`))
}

function registryWith(faces: Partial<FontFaces> = {}): FontRegistry {
  return new Map([
    [
      DEFAULT_FONT_FAMILY,
      {
        regular: faceBytes('NotoSansSC-Regular.otf'),
        bold: faceBytes('NotoSansSC-Bold.otf'),
        ...faces,
      },
    ],
  ])
}

const measurer = createFontkitTextMeasurer(registryWith())
const style: TextStyle = DEFAULT_TEXT_STYLE

describe('FontkitTextMeasurer', () => {
  it('measures an empty line as zero width', () => {
    expect(measurer.measureLine('', style)).toBe(0)
  })

  it('advances a Han ideograph exactly one em', () => {
    expect(measurer.measureLine('简', style)).toBe(style.fontSize)
    expect(measurer.measureLine('简历', style)).toBe(2 * style.fontSize)
  })

  it('scales shaped Latin advances with the font size', () => {
    // 3733 font units at 1000 unitsPerEm, measured against the bundled face.
    expect(measurer.measureLine('Resume', style)).toBeCloseTo(3.733 * style.fontSize, 6)
  })

  it('refuses a family the registry does not carry, naming it and the available ones', () => {
    expect(() => measurer.measureLine('a', { ...style, fontFamily: 'Georgia' })).toThrow(
      MissingFontFamilyError,
    )
    try {
      measurer.measureLine('a', { ...style, fontFamily: 'Georgia' })
      expect.unreachable()
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(MissingFontFamilyError)
      expect((thrown as MissingFontFamilyError).message).toContain('Georgia')
      expect((thrown as MissingFontFamilyError).message).toContain(DEFAULT_FONT_FAMILY)
    }
  })

  it('measures the bold face when the weight asks for it', () => {
    const latin = 'W'.repeat(10)
    const regular = measurer.measureLine(latin, style)
    const bold = measurer.measureLine(latin, { ...style, fontWeight: 700 })

    expect(bold).toBeGreaterThan(regular)
  })

  it('resolves weights at the six-hundred boundary', () => {
    const latin = 'W'.repeat(10)
    const regular = measurer.measureLine(latin, style)
    const bold = measurer.measureLine(latin, { ...style, fontWeight: 700 })

    expect(measurer.measureLine(latin, { ...style, fontWeight: 500 })).toBe(regular)
    expect(measurer.measureLine(latin, { ...style, fontWeight: 600 })).toBe(bold)
  })

  it('falls back to the regular face when no bold face is registered', () => {
    const regularOnly = createFontkitTextMeasurer(
      registryWith({ bold: null }),
    )
    const latin = 'W'.repeat(10)

    expect(regularOnly.measureLine(latin, { ...style, fontWeight: 700 })).toBe(
      regularOnly.measureLine(latin, style),
    )
  })

  it('fails loudly on corrupt face bytes instead of measuring with them', () => {
    const corrupt = createFontkitTextMeasurer(
      registryWith({ regular: new Uint8Array([0, 1, 2, 3]) }),
    )

    // Garbage bytes must throw at the first measure, never yield a width:
    // a zero or fallback width would silently move every line break.
    expect(() => corrupt.measureLine('a', style)).toThrow()
  })

  it('keeps a surrogate pair in one cluster', () => {
    expect(measurer.measureClusters('👍', style)).toHaveLength(1)
  })

  it('keeps a combining mark on its base cluster', () => {
    const clusters = measurer.measureClusters('e\u0301', style)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toBeCloseTo(measurer.measureLine('e\u0301', style), 6)
  })

  it('charges a Han cluster one em and sums clusters to the line width', () => {
    const text = '简历工作'
    const clusters = measurer.measureClusters(text, style)

    expect(clusters).toHaveLength(text.length)
    for (const cluster of clusters) expect(cluster).toBe(style.fontSize)
    expect(clusters.reduce((total, width) => total + width, 0)).toBeCloseTo(
      measurer.measureLine(text, style),
      6,
    )
  })

  it('feeds pagination: a CJK paragraph breaks at exactly the width limit', () => {
    // 100 points of content at 10 points per ideograph: ten per line, and
    // twenty-five characters fill two lines and part of a third.
    const paragraph = '简'.repeat(25)
    const result = layout({
      blocks: [textMaterializedBlock(paragraph, 10)],
      page: {
        pageWidth: 100,
        pageHeight: 500,
        columns: 1,
        marginTop: 0,
        marginRight: 0,
        marginBottom: 0,
        marginLeft: 0,
      },
      measurer,
    })
    expect(result.overflows).toHaveLength(0)
    const lines = result.blocks[0]?.lines ?? []
    expect(lines).toHaveLength(3)
    expect(lines[0]?.text).toBe('简'.repeat(10))
    expect(lines[1]?.text).toBe('简'.repeat(10))
    expect(lines[2]?.text).toBe('简'.repeat(5))
  })
})

function textMaterializedBlock(text: string, fontSize: number): MaterializedBlock {
  return {
    id: asBlockId('block-text'),
    content: { type: 'text', text },
    layout: { mode: 'flow', columnSpan: 1 },
    textStyle: { ...DEFAULT_TEXT_STYLE, fontSize },
    claims: [],
  }
}
