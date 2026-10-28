/**
 * @file InfoEntry.test
 * @description Derived titles: every module's title source, the degree label, the
 * custom module's built-in title and the fallback for a half-filled entry.
 */

import { describe, expect, it } from 'vitest'

import { deriveEntryTitle, UNTITLED_ENTRY } from '../../../src/domain/info/InfoEntry'
import type { InfoFieldValue } from '../../../src/domain/info/InfoFieldValue'
import { customModuleFixture } from '../../support/infoFixtures'

function fields(record: Readonly<Record<string, InfoFieldValue>>): Readonly<Record<string, InfoFieldValue>> {
  return record
}

describe('deriveEntryTitle', () => {
  it('titles a personal entry by the full name', () => {
    expect(deriveEntryTitle('personal', null, fields({ fullName: '张三' }))).toBe('张三')
  })

  it('titles an education entry by the school and the degree label', () => {
    expect(
      deriveEntryTitle(
        'education',
        null,
        fields({ school: '复旦大学', degree: 'master' }),
      ),
    ).toBe('复旦大学（硕士）')
    expect(deriveEntryTitle('education', null, fields({ school: '复旦大学' }))).toBe('复旦大学')
  })

  it('joins the company and the role of an internship', () => {
    expect(
      deriveEntryTitle('internship', null, fields({ company: '某公司', role: '后端开发' })),
    ).toBe('某公司 · 后端开发')
    expect(deriveEntryTitle('internship', null, fields({ company: '某公司' }))).toBe('某公司')
  })

  it('titles project, skill and award entries by their name', () => {
    expect(deriveEntryTitle('project', null, fields({ name: '订单中台' }))).toBe('订单中台')
    expect(deriveEntryTitle('skill', null, fields({ name: 'TypeScript' }))).toBe('TypeScript')
    expect(deriveEntryTitle('award', null, fields({ name: '数学建模' }))).toBe('数学建模')
  })

  it('titles a job intent by the target role', () => {
    expect(deriveEntryTitle('jobIntent', null, fields({ targetRole: '后端工程师' }))).toBe(
      '后端工程师',
    )
  })

  it('keeps the first 24 code points of a self evaluation', () => {
    const content = '好'.repeat(30)
    const title = deriveEntryTitle('selfEvaluation', null, fields({ content }))
    expect(title).toBe('好'.repeat(24))
    expect([...title]).toHaveLength(24)
  })

  it('titles a custom entry by its built-in title field', () => {
    const custom = customModuleFixture()
    expect(deriveEntryTitle('custom', custom, fields({ title: 'CET-6' }))).toBe('CET-6')
  })

  it('falls back to 未命名 when the title source is missing or blank', () => {
    expect(deriveEntryTitle('personal', null, fields({}))).toBe(UNTITLED_ENTRY)
    expect(deriveEntryTitle('personal', null, fields({ fullName: '  ' }))).toBe(UNTITLED_ENTRY)
    expect(deriveEntryTitle('project', null, fields({}))).toBe(UNTITLED_ENTRY)
    expect(deriveEntryTitle('custom', customModuleFixture(), fields({}))).toBe(UNTITLED_ENTRY)
    expect(UNTITLED_ENTRY).toBe('未命名')
  })
})
