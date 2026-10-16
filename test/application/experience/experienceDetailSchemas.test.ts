import { describe, expect, it } from 'vitest'
import { parseExperienceDetail } from '../../../src/application/catalog/experienceDetailSchemas'

describe('parseExperienceDetail', () => {
  it('keeps the education fields and strips a key no schema carries', () => {
    const result = parseExperienceDetail('education', {
      school: '某大学',
      degree: '学士',
      major: '计算机',
      legacyField: '旧字段',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      school: '某大学',
      degree: '学士',
      major: '计算机',
    })
  })

  it('requires the school of an education record', () => {
    const result = parseExperienceDetail('education', { degree: '学士', major: '计算机' })

    expect(result.ok).toBe(false)
  })

  it('requires the company and the role of an internship', () => {
    expect(parseExperienceDetail('internship', { team: '平台组' }).ok).toBe(false)
    expect(
      parseExperienceDetail('internship', { company: '某公司', role: '实习生', technologies: [] })
        .ok,
    ).toBe(true)
  })

  it('requires every list a work record carries', () => {
    expect(parseExperienceDetail('work', { company: '某公司', role: '工程师' }).ok).toBe(false)
    expect(
      parseExperienceDetail('work', {
        company: '某公司',
        department: '基础架构部',
        role: '工程师',
        technologies: ['Go'],
        highlights: ['重构了构建流水线'],
      }).ok,
    ).toBe(true)
  })

  it('requires the role and the lists of a project', () => {
    expect(parseExperienceDetail('project', { technologies: [], highlights: [] }).ok).toBe(false)
    expect(
      parseExperienceDetail('project', {
        repoUrl: 'https://example.invalid/tool',
        role: '作者',
        technologies: ['TypeScript'],
        highlights: [],
      }).ok,
    ).toBe(true)
  })

  it('requires the issuer of an award', () => {
    expect(parseExperienceDetail('award', { level: '校级' }).ok).toBe(false)
    expect(
      parseExperienceDetail('award', { issuer: '某委员会', certificateNo: 'A-2024-01' }).ok,
    ).toBe(true)
  })

  it('requires the category and the items of a skill', () => {
    expect(parseExperienceDetail('skill', { category: '后端' }).ok).toBe(false)
    expect(
      parseExperienceDetail('skill', { category: '后端', items: ['Go'], proficiency: '熟练' }).ok,
    ).toBe(true)
  })

  it('requires the highlights of a summary', () => {
    expect(parseExperienceDetail('summary', {}).ok).toBe(false)
    expect(parseExperienceDetail('summary', { highlights: ['八年后端经验'] }).ok).toBe(true)
  })

  it('rejects a field whose type does not match the schema', () => {
    expect(parseExperienceDetail('summary', { highlights: '八年后端经验' }).ok).toBe(false)
  })
})
