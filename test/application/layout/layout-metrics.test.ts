import { describe, expect, it } from 'vitest'
import { findBreakOpportunities } from '../../../src/application/layout/layout-metrics'

describe('findBreakOpportunities', () => {
  it('keeps a Latin word whole and breaks after its spaces', () => {
    expect(findBreakOpportunities('backend engineer')).toEqual([8])
  })

  it('does not break inside a run of spaces', () => {
    expect(findBreakOpportunities('a  b')).toEqual([3])
  })

  it('breaks between CJK characters', () => {
    expect(findBreakOpportunities('负责服务治理')).toEqual([1, 2, 3, 4, 5])
  })

  it('breaks at a Latin to CJK boundary and not inside the Latin word', () => {
    expect(findBreakOpportunities('负责SLA治理')).toEqual([1, 2, 5, 6])
  })

  it('breaks after a hyphen', () => {
    expect(findBreakOpportunities('full-stack')).toEqual([5])
  })

  it('keeps closing punctuation with the character before it', () => {
    const text = '服务治理。'
    const opportunities = findBreakOpportunities(text)
    expect(opportunities).toEqual([1, 2, 3])
    // The last legal break puts the mark on the line with 理, never on the next.
    expect(text.slice(opportunities[opportunities.length - 1] ?? 0)).toBe('理。')
  })

  it('never ends a line with opening punctuation', () => {
    const opportunities = findBreakOpportunities('负责（服务）治理')
    expect(opportunities).toEqual([1, 2, 4, 6, 7])
    // Index 3 is the position right after the opening bracket.
    expect(opportunities).not.toContain(3)
  })

  it('returns no opportunity for a string that cannot break', () => {
    expect(findBreakOpportunities('backend')).toEqual([])
    expect(findBreakOpportunities('')).toEqual([])
  })

  it('treats a newline as a break', () => {
    expect(findBreakOpportunities('first\nsecond')).toEqual([6])
  })

  it('counts a surrogate pair as one character', () => {
    const text = '甲😀乙'
    expect(findBreakOpportunities(text)).toEqual([1, 3])
  })
})
