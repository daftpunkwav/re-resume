/**
 * @file KnowledgeDate.test
 * @description Parsing, formatting and ordering of the month-precision calendar
 * value. The parser is strict; the ordering has to keep an ongoing range above
 * every completed one.
 */

import { describe, expect, it } from 'vitest'

import {
  compareKnowledgeDate,
  formatKnowledgeDate,
  knowledgeDateSortKey,
  parseKnowledgeDate,
  PRESENT,
} from '../../../src/domain/shared/KnowledgeDate'

describe('parseKnowledgeDate', () => {
  it('accepts a year and a year with a month', () => {
    expect(parseKnowledgeDate('2024')).toBe('2024')
    expect(parseKnowledgeDate('2024-06')).toBe('2024-06')
    expect(parseKnowledgeDate('1900-01')).toBe('1900-01')
    expect(parseKnowledgeDate('2100-12')).toBe('2100-12')
  })

  it('accepts the ongoing value', () => {
    expect(parseKnowledgeDate('present')).toBe(PRESENT)
  })

  it.each([
    ['2024-13', 'month above 12'],
    ['2024-00', 'month 00'],
    ['2024-1', 'one-digit month'],
    ['2024-06-01', 'a full calendar date'],
    ['1899-12', 'year below the range'],
    ['2101-01', 'year above the range'],
    ['Present', 'upper-case ongoing value'],
    [' present', 'leading whitespace'],
    ['2024 ', 'trailing whitespace'],
    ['', 'empty text'],
    ['24-06', 'two-digit year'],
  ])('rejects %s (%s)', (raw) => {
    expect(parseKnowledgeDate(raw)).toBeNull()
  })
})

describe('formatKnowledgeDate', () => {
  it('formats a month, a year, and the ongoing value', () => {
    expect(formatKnowledgeDate(parseKnowledgeDate('2024-06')!)).toBe('2024 年 6 月')
    expect(formatKnowledgeDate(parseKnowledgeDate('2024')!)).toBe('2024 年')
    expect(formatKnowledgeDate(PRESENT)).toBe('至今')
  })

  it('does not keep the zero padding of a month in the display form', () => {
    expect(formatKnowledgeDate(parseKnowledgeDate('2024-01')!)).toBe('2024 年 1 月')
  })
})

describe('knowledgeDateSortKey', () => {
  it('orders years before months and counts a year-only value as January', () => {
    expect(knowledgeDateSortKey(parseKnowledgeDate('2024')!)).toBe(
      knowledgeDateSortKey(parseKnowledgeDate('2024-01')!),
    )
    expect(knowledgeDateSortKey(parseKnowledgeDate('2023-12')!)).toBeLessThan(
      knowledgeDateSortKey(parseKnowledgeDate('2024')!),
    )
    expect(knowledgeDateSortKey(parseKnowledgeDate('2024-05')!)).toBeLessThan(
      knowledgeDateSortKey(parseKnowledgeDate('2024-06')!),
    )
  })

  it('places the ongoing value after every calendar value in range', () => {
    expect(knowledgeDateSortKey(PRESENT)).toBeGreaterThan(
      knowledgeDateSortKey(parseKnowledgeDate('2100-12')!),
    )
  })
})

describe('compareKnowledgeDate', () => {
  it('is negative when the left value is earlier, zero when equal', () => {
    const earlier = parseKnowledgeDate('2024-05')!
    const later = parseKnowledgeDate('2024-06')!
    expect(compareKnowledgeDate(earlier, later)).toBeLessThan(0)
    expect(compareKnowledgeDate(later, earlier)).toBeGreaterThan(0)
    expect(compareKnowledgeDate(earlier, earlier)).toBe(0)
  })

  it('keeps end after start for every completed range and for the ongoing one', () => {
    const start = parseKnowledgeDate('2024-06')!
    expect(compareKnowledgeDate(start, PRESENT)).toBeLessThan(0)
    expect(compareKnowledgeDate(start, parseKnowledgeDate('2024-06')!)).toBe(0)
    expect(compareKnowledgeDate(PRESENT, start)).toBeGreaterThan(0)
  })
})
