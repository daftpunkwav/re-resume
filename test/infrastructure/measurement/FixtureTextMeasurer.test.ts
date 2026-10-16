import { describe, expect, it } from 'vitest'
import { FixtureTextMeasurer } from '../../../src/infrastructure/measurement/FixtureTextMeasurer'
import { DEFAULT_TEXT_STYLE } from '../../../src/domain/resume/TextStyle'
import type { TextStyle } from '../../../src/domain/resume/TextStyle'

const measurer = new FixtureTextMeasurer()
const style: TextStyle = DEFAULT_TEXT_STYLE

describe('FixtureTextMeasurer', () => {
  it('gives every Latin cluster one em', () => {
    expect(measurer.measureLine('abcd', style)).toBe(4 * style.fontSize)
  })

  it('gives a Han cluster two ems, so mixed script wraps about twice as fast', () => {
    expect(measurer.measureLine('简历', style)).toBe(4 * style.fontSize)
    expect(measurer.measureLine('中A', style)).toBe(3 * style.fontSize)
  })

  it('treats fullwidth punctuation as wide', () => {
    expect(measurer.measureLine('。', style)).toBe(2 * style.fontSize)
  })

  it('gives a space half an em', () => {
    expect(measurer.measureLine('a b', style)).toBe(2.5 * style.fontSize)
  })

  it('scales with the style font size', () => {
    expect(measurer.measureLine('abcd', { ...style, fontSize: style.fontSize * 2 })).toBe(
      2 * measurer.measureLine('abcd', style),
    )
  })

  it('ignores font family and weight, because it has one width table', () => {
    const bold = measurer.measureLine('abcd', { ...style, fontWeight: 700, fontFamily: 'Other' })

    expect(bold).toBe(measurer.measureLine('abcd', style))
  })

  it('keeps a combining mark inside the cluster it belongs to', () => {
    const clusters = measurer.measureClusters('é', style)

    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toBe(style.fontSize)
  })

  it('keeps an emoji sequence together as one cluster', () => {
    expect(measurer.measureClusters('👍', style)).toHaveLength(1)
  })

  it('sums cluster widths to the line width', () => {
    const text = '主导服务拆分 with TypeScript，done'

    const clusters = measurer.measureClusters(text, style)

    expect(clusters.reduce((total, width) => total + width, 0)).toBe(measurer.measureLine(text, style))
  })

  it('returns one cluster width per grapheme cluster', () => {
    expect(measurer.measureClusters('简历A', style)).toEqual([22, 22, 11])
  })

  it('measures an empty line as zero', () => {
    expect(measurer.measureLine('', style)).toBe(0)
    expect(measurer.measureClusters('', style)).toEqual([])
  })

  it('is deterministic across calls and across instances', () => {
    const text = '五年后端经验，主导服务拆分'

    const first = new FixtureTextMeasurer().measureLine(text, style)
    const second = new FixtureTextMeasurer().measureLine(text, style)

    expect(first).toBe(second)
    expect(first).toBe(measurer.measureLine(text, style))
  })

  it('accepts a replaced width table for a document-specific fixture', () => {
    const wideLatin = new FixtureTextMeasurer({ blank: 0, latin: 2, wide: 4 })

    expect(wideLatin.measureLine('a简历', style)).toBe(10 * style.fontSize)
  })
})
