/**
 * @file suggestedPdfFileName.test
 * @description The naming rule of the export dialog: person, role and company
 * when they exist, the resume title as the fallback, and a platform-safe stem.
 */

import { describe, expect, it } from 'vitest'

import { suggestedPdfFileName } from '../../../src/application/export/suggestedPdfFileName'
import type { TargetJob } from '../../../src/domain/resume/TargetJob'
import { aResume } from '../../support/resumeFixtures'

function resumeWith(options: {
  readonly title?: string
  readonly targetJob?: TargetJob | null
}) {
  return aResume({ id: 'resume-named', title: options.title, targetJob: options.targetJob }).resume
}

function targetJob(title: string | null, company: string | null): TargetJob {
  return { title, company, jobPostingId: null }
}

describe('suggestedPdfFileName', () => {
  it('joins the person, role and company in that order', () => {
    const resume = resumeWith({ targetJob: targetJob('后端工程师', '目标公司') })
    expect(suggestedPdfFileName(resume, '林清越')).toBe('林清越-后端工程师-目标公司.pdf')
  })

  it('skips a missing component instead of printing an empty hyphen', () => {
    const resume = resumeWith({ targetJob: targetJob('产品经理', null) })
    expect(suggestedPdfFileName(resume, '林清越')).toBe('林清越-产品经理.pdf')
    expect(suggestedPdfFileName(resume, null)).toBe('产品经理.pdf')
  })

  it('falls back to the resume title when nothing else is known', () => {
    const resume = resumeWith({ title: '测试简历', targetJob: null })
    expect(suggestedPdfFileName(resume, null)).toBe('测试简历.pdf')
  })

  it('replaces path characters and keeps a trailing-dot-free stem', () => {
    const resume = resumeWith({ title: '简历: "终版"', targetJob: targetJob('a/b', 'c?') })
    const name = suggestedPdfFileName(resume, '林清越/..')
    expect(name).toBe('林清越 ..-a b-c.pdf')
    expect(name.endsWith('.pdf')).toBe(true)
  })

  it('bounds a long stem by code points', () => {
    const resume = resumeWith({ title: '标'.repeat(120), targetJob: null })
    const name = suggestedPdfFileName(resume, null)
    expect([...name.replace(/\.pdf$/u, '')]).toHaveLength(80)
  })

  it('never returns an empty stem', () => {
    const resume = resumeWith({ title: '***', targetJob: null })
    expect(suggestedPdfFileName(resume, null)).toBe('简历.pdf')
    expect(suggestedPdfFileName(resumeWith({ title: '   ' }), null)).toBe('简历.pdf')
  })
})
