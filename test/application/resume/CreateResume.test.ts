import { describe, expect, it } from 'vitest'
import { createResume } from '../../../src/application/resume/CreateResume'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { INITIAL_REVISION_LABEL } from '../../../src/domain/resume/Revision'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import { InMemoryResumeRepository } from '../../support/inMemoryResumeRepository'

describe('createResume', () => {
  it('creates the resume together with its initial revision', async () => {
    const clock = new FixedClock()
    const repo = new InMemoryResumeRepository(() => clock.now())

    const resumeId = await createResume(repo, new SequentialIdGenerator('resume'), clock, {
      title: '后端简历',
      targetRole: '后端工程师',
    })

    const stored = await repo.findById(resumeId)
    expect(stored?.title).toBe('后端简历')
    expect(stored?.targetRole).toBe('后端工程师')
    expect(stored?.status).toBe('draft')
    expect(stored?.pageSetup).toEqual(A4_PAGE_SETUP)
    expect(stored?.blocks).toHaveLength(0)
    expect(stored?.snapshots).toHaveLength(0)
    expect(stored?.currentRevision).toBeDefined()
  })

  it('starts the chain on seq 1 with the initial revision label', async () => {
    const clock = new FixedClock()
    const repo = new InMemoryResumeRepository(() => clock.now())

    const resumeId = await createResume(repo, new SequentialIdGenerator('resume'), clock, {
      title: '空简历',
      targetRole: null,
    })

    const history = repo.historyOf(resumeId)
    expect(history).toHaveLength(1)
    expect(history[0]?.seq).toBe(1)
    expect(history[0]?.label).toBe(INITIAL_REVISION_LABEL)
    expect(history[0]?.origin).toBe('user')
    expect(history[0]?.runId).toBeNull()
    expect(history[0]?.supersededAt).toBeNull()
    expect(history[0]?.state.blocks).toHaveLength(0)
    expect(history[0]?.state.pageSetup).toEqual(A4_PAGE_SETUP)
    const stored = await repo.findById(resumeId)
    expect(stored?.currentRevision).toBe(history[0]?.id)
  })

  it('allocates identifiers from the injected generator', async () => {
    const clock = new FixedClock()
    const repo = new InMemoryResumeRepository(() => clock.now())
    const ids = new SequentialIdGenerator('resume')

    const first = await createResume(repo, ids, clock, { title: '一号', targetRole: null })
    const second = await createResume(repo, ids, clock, { title: '二号', targetRole: null })

    expect(first).toBe('resume-1')
    expect(second).toBe('resume-3')
    expect(repo.historyOf(first)[0]?.id).toBe('resume-2')
  })
})
