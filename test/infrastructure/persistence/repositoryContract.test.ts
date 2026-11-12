/**
 * @file repositoryContract
 * @description One contract suite run against both flavors of the same
 * persistence ports: the memory-backed preview repositories and the SQLite
 * repositories over a fully migrated in-memory database. The subtle rules both
 * implementations must agree on — the revision chain that doubles as undo/redo
 * history, the single-running run gate, and the sort-order discipline of the
 * information library — are asserted here once, so a rule change has to answer
 * to both sides or the suite names which side moved.
 *
 * Responsibilities:
 * - Pin the observable repository behaviour both flavors share: supersession
 *   and cursor semantics, the never-reused sequence, the trim window, the run
 *   gate, and the dense reorder rewrite
 * - Pin the documented divergences in their own suite instead of weakening the
 *   shared assertions
 *
 * Constraints:
 * - Tests only: no src/ file may change to satisfy a case here. Where the two
 *   flavors disagree, each case pins the behaviour its flavor ships today and
 *   its comment names the divergence.
 * - The SQLite side runs over `createMigratedDatabase()`, so the schema under
 *   test is exactly the one the shipped migration files declare.
 * - `DomainError` codes are part of the contract, so shared cases match codes;
 *   error message texts are not, so shared cases match plain failures only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AgentRun } from '../../../src/domain/generation/AgentRun'
import type { AgentRunRepository } from '../../../src/domain/generation/ports/AgentRunRepository'
import type { ChangeRecord } from '../../../src/domain/changes/ChangeRecord'
import type { Conversation } from '../../../src/domain/conversation/Conversation'
import type { ConversationRepository } from '../../../src/domain/conversation/ports/ConversationRepository'
import type { MessageRepository } from '../../../src/domain/conversation/ports/MessageRepository'
import type { InfoEntry } from '../../../src/domain/info/InfoEntry'
import type { InfoEntryRepository } from '../../../src/domain/info/ports/InfoEntryRepository'
import type { Revision } from '../../../src/domain/resume/Revision'
import type { ResumeRepository } from '../../../src/domain/resume/ports/ResumeRepository'
import type { ResumeSnapshot } from '../../../src/domain/resume/ResumeSnapshot'
import {
  asAgentRunId,
  asChangeRecordId,
  asConversationId,
  asInfoEntryId,
  asResumeId,
  asRevisionId,
  asSnapshotId,
} from '../../../src/domain/shared/branded-id'
import type { ConversationId, ResumeId, RevisionId } from '../../../src/domain/shared/branded-id'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { SqliteAgentRunRepository } from '../../../src/infrastructure/persistence/conversation/SqliteAgentRunRepository'
import { SqliteConversationRepository } from '../../../src/infrastructure/persistence/conversation/SqliteConversationRepository'
import { SqliteMessageRepository } from '../../../src/infrastructure/persistence/conversation/SqliteMessageRepository'
import { SqliteCustomModuleRepository } from '../../../src/infrastructure/persistence/info/SqliteCustomModuleRepository'
import { SqliteInfoEntryRepository } from '../../../src/infrastructure/persistence/info/SqliteInfoEntryRepository'
import {
  DEFAULT_REVISION_LIMIT as SQLITE_REVISION_LIMIT,
  SqliteResumeRepository,
} from '../../../src/infrastructure/persistence/resume/SqliteResumeRepository'
import {
  InMemoryAgentRunRepository,
  InMemoryConversationRepository,
  InMemoryMessageRepository,
} from '../../../src/infrastructure/preview/inMemoryConversationRepositories'
import {
  InMemoryChangeLogRepository,
  InMemoryInfoEntryRepository,
} from '../../../src/infrastructure/preview/inMemoryInfoRepositories'
import {
  DEFAULT_REVISION_LIMIT as IN_MEMORY_REVISION_LIMIT,
  InMemoryResumeRepository,
} from '../../../src/infrastructure/preview/inMemoryResumeRepository'
import { infoEntryFixture, validRawFields } from '../../support/infoFixtures'
import { createMigratedDatabase } from '../../support/nodeSqliteDatabase'
import { aDocument, aResume, FIXTURE_TIME, TestClock, TestIds } from '../../support/resumeFixtures'

const LATER: DateTime = parseDateTime('2026-01-01T00:00:05.000Z') as DateTime

/** One flavor's repositories plus the seams the shared assertions need. */
interface ContractBed {
  /** Which flavor the bed assembles, so a failure message names the side. */
  readonly flavor: 'in-memory' | 'sqlite'
  readonly resumes: ResumeRepository
  readonly conversations: ConversationRepository
  readonly runs: AgentRunRepository
  readonly messages: MessageRepository
  readonly entries: InfoEntryRepository
  /** Change records the info entry repository has committed so far. */
  readonly countChangeRecords: () => Promise<number>
  /** Releases what the bed holds; a no-op for the memory flavor. */
  readonly close: () => void
}

interface BedOptions {
  /** Overrides the trim window both resume repositories accept. */
  readonly revisionLimit?: number
}

function createInMemoryBed(options: BedOptions = {}): ContractBed {
  const clock = new TestClock()
  const changes = new InMemoryChangeLogRepository()
  const runs = new InMemoryAgentRunRepository()
  return {
    flavor: 'in-memory',
    resumes: new InMemoryResumeRepository(clock, options.revisionLimit),
    conversations: new InMemoryConversationRepository(),
    runs,
    // The gate reads the run map through the same Map instance the run
    // repository writes, mirroring how the preview wires the pair.
    messages: new InMemoryMessageRepository({ runs: runs.rows }),
    entries: new InMemoryInfoEntryRepository(changes),
    countChangeRecords: async () => changes.all().length,
    close: () => {},
  }
}

function createSqliteBed(options: BedOptions = {}): ContractBed {
  const database = createMigratedDatabase()
  const clock = new TestClock()
  const ids = new TestIds('contract')
  const customModules = new SqliteCustomModuleRepository(database)
  return {
    flavor: 'sqlite',
    resumes:
      options.revisionLimit === undefined
        ? new SqliteResumeRepository(database, clock, ids)
        : new SqliteResumeRepository(database, clock, ids, options.revisionLimit),
    conversations: new SqliteConversationRepository(database),
    runs: new SqliteAgentRunRepository(database),
    messages: new SqliteMessageRepository(database),
    entries: new SqliteInfoEntryRepository(database, customModules),
    countChangeRecords: async () => {
      const rows = await database.select<{ readonly count: number }>(
        'SELECT COUNT(*) AS count FROM change_record',
      )
      return rows[0]?.count ?? 0
    },
    close: () => {
      database.close()
    },
  }
}

interface Flavor {
  readonly name: string
  readonly createBed: (options?: BedOptions) => ContractBed
}

const FLAVORS: readonly Flavor[] = [
  { name: 'in-memory repositories', createBed: createInMemoryBed },
  { name: 'sqlite repositories', createBed: createSqliteBed },
]

function aConversation(id: string): Conversation {
  return {
    id: asConversationId(id),
    title: '契约对话',
    providerId: null,
    modelId: null,
    pinned: false,
    activeResumeId: null,
    summary: null,
    summaryThroughSeq: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function aRun(id: string, conversationId: ConversationId | null): AgentRun {
  return {
    id: asAgentRunId(id),
    conversationId,
    resumeId: null,
    jobPostingId: null,
    status: 'running',
    errorText: null,
    promptTokens: null,
    completionTokens: null,
    startedAt: FIXTURE_TIME,
    endedAt: null,
  }
}

let changeCounter = 0

function aChange(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  changeCounter += 1
  return {
    id: asChangeRecordId(`change-${changeCounter.toString()}`),
    scope: 'library',
    entity: 'infoEntry',
    entityId: 'entry-1',
    op: 'infoEntry.create',
    beforeJson: null,
    afterJson: JSON.stringify({ id: 'entry-1' }),
    origin: 'user',
    runId: null,
    conversationId: null,
    label: '契约测试变更',
    undoneAt: null,
    createdAt: FIXTURE_TIME,
    ...overrides,
  }
}

function projectEntry(id: string, sortOrder: number): InfoEntry {
  return infoEntryFixture({
    id,
    moduleKind: 'project',
    fields: validRawFields('project', { name: `项目${id}` }),
    sortOrder,
  })
}

async function saveRevision(
  bed: ContractBed,
  resumeId: ResumeId,
  expected: RevisionId,
  label: string,
): Promise<Revision> {
  return bed.resumes.saveDocument(
    resumeId,
    aDocument(),
    { label, origin: 'user', runId: null },
    expected,
  )
}

/** The superseded stamp of a revision, with a missing row read as null. */
function stampOf(
  revisions: readonly Revision[],
  revisionId: RevisionId,
): DateTime | null {
  return revisions.find((revision) => revision.id === revisionId)?.supersededAt ?? null
}

function describeResumeContract(flavor: Flavor): void {
  describe(`${flavor.name}: resume revision chain`, () => {
    let bed: ContractBed

    beforeEach(() => {
      bed = flavor.createBed()
    })

    afterEach(() => {
      bed.close()
    })

    it('appends revisions whose sequence is never reused across undo branches', async () => {
      const fixture = aResume()
      await bed.resumes.insertWithInitialRevision(fixture.resume, fixture.revision)

      const forward = await saveRevision(bed, fixture.resume.id, fixture.revision.id, '向前一步')
      expect(forward.seq).toBe(2)

      // Undo back to the first revision, then take a new change: the abandoned
      // branch keeps its row and its sequence number, so the new revision
      // continues the history instead of reusing seq 2.
      await bed.resumes.moveCursor(fixture.resume.id, fixture.revision.id)
      const branch = await saveRevision(bed, fixture.resume.id, fixture.revision.id, '新分支')
      expect(branch.seq).toBe(3)

      const revisions = await bed.resumes.listRevisions(fixture.resume.id)
      expect(revisions.map((revision) => revision.seq)).toEqual([1, 2, 3])
      expect(stampOf(revisions, fixture.revision.id)).toBeNull()
      expect(stampOf(revisions, forward.id)).not.toBeNull()
      expect(stampOf(revisions, branch.id)).toBeNull()

      // The abandoned revision may no longer become the cursor; the branch
      // point and the new tail are both still live.
      await expect(
        bed.resumes.moveCursor(fixture.resume.id, forward.id),
      ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })

      const loaded = await bed.resumes.findById(fixture.resume.id)
      expect(loaded?.currentRevision).toBe(branch.id)
      expect(loaded?.document).toEqual(branch.state)
    })

    it('moves the cursor onto a live revision for undo and redo', async () => {
      const first = aResume({ id: 'resume-a' })
      const second = aResume({ id: 'resume-b' })
      await bed.resumes.insertWithInitialRevision(first.resume, first.revision)
      await bed.resumes.insertWithInitialRevision(second.resume, second.revision)

      const forward = await saveRevision(bed, first.resume.id, first.revision.id, '前进')

      // Another resume's revision and an unknown one are both refused with the
      // same code the abandoned-branch refusal uses.
      await expect(
        bed.resumes.moveCursor(first.resume.id, second.revision.id),
      ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })
      await expect(
        bed.resumes.moveCursor(first.resume.id, asRevisionId('missing')),
      ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })

      // Undo lands on the state of the revision it names; a cursor move alone
      // supersedes nothing, so walking back up the chain is the redo path.
      await bed.resumes.moveCursor(first.resume.id, first.revision.id)
      expect((await bed.resumes.findById(first.resume.id))?.document).toEqual(
        first.revision.state,
      )

      await bed.resumes.moveCursor(first.resume.id, forward.id)
      const loaded = await bed.resumes.findById(first.resume.id)
      expect(loaded?.currentRevision).toBe(forward.id)
      expect(loaded?.document).toEqual(forward.state)
    })

    it('refuses a save whose expected revision the cursor has left behind', async () => {
      const fixture = aResume()
      await bed.resumes.insertWithInitialRevision(fixture.resume, fixture.revision)
      await saveRevision(bed, fixture.resume.id, fixture.revision.id, '第一步')

      await expect(
        bed.resumes.saveDocument(
          fixture.resume.id,
          aDocument(),
          { label: '过期的一步', origin: 'user', runId: null },
          fixture.revision.id,
        ),
      ).rejects.toMatchObject({ code: 'revisionMismatch' })
    })

    it('refuses a save and a cursor move on a frozen resume', async () => {
      const fixture = aResume()
      await bed.resumes.insertWithInitialRevision(fixture.resume, fixture.revision)
      const snapshot: ResumeSnapshot = {
        id: asSnapshotId('snapshot-1'),
        resumeId: fixture.resume.id,
        seq: 1,
        frozenState: fixture.resume.document,
        materialized: { blocks: [], missingReferences: [], warnings: [] },
        createdAt: FIXTURE_TIME,
      }
      await bed.resumes.appendSnapshot(snapshot, fixture.revision.id)

      await expect(
        bed.resumes.saveDocument(
          fixture.resume.id,
          aDocument(),
          { label: '冻结后再改', origin: 'user', runId: null },
          fixture.revision.id,
        ),
      ).rejects.toMatchObject({ code: 'resumeFrozen' })
      await expect(
        bed.resumes.moveCursor(fixture.resume.id, fixture.revision.id),
      ).rejects.toMatchObject({ code: 'resumeFrozen' })
    })

    it('refuses a save for a resume that does not exist', async () => {
      await expect(
        bed.resumes.saveDocument(
          asResumeId('missing'),
          aDocument(),
          { label: '无处落笔', origin: 'user', runId: null },
          asRevisionId('nowhere'),
        ),
      ).rejects.toMatchObject({ code: 'resumeNotFound' })
    })

    it('keeps the newest live window and never deletes a superseded row', async () => {
      // The window rule is exercised with a small limit so the suite does not
      // append two hundred revisions; the trim code path is the same one the
      // default limit runs.
      const trimmed = flavor.createBed({ revisionLimit: 3 })
      try {
        const fixture = aResume()
        await trimmed.resumes.insertWithInitialRevision(fixture.resume, fixture.revision)
        let cursor = fixture.revision.id
        for (let index = 2; index <= 7; index += 1) {
          const revision = await saveRevision(trimmed, fixture.resume.id, cursor, `第${index}步`)
          cursor = revision.id
        }

        // A purely forward history holds no superseded rows, so the window
        // trims its oldest live rows: only the newest three survive.
        const afterForward = await trimmed.resumes.listRevisions(fixture.resume.id)
        expect(afterForward.map((revision) => revision.seq)).toEqual([5, 6, 7])
        const head = afterForward[0]
        const redoFirst = afterForward[1]
        const redoSecond = afterForward[2]
        if (head === undefined || redoFirst === undefined || redoSecond === undefined) {
          throw new Error('The trim window kept fewer than three revisions.')
        }

        // Undo to the window start and take a new change: the redo rows above
        // the cursor are superseded, not deleted.
        await trimmed.resumes.moveCursor(fixture.resume.id, head.id)
        const branch = await saveRevision(trimmed, fixture.resume.id, head.id, '回头分支')
        const afterBranch = await trimmed.resumes.listRevisions(fixture.resume.id)
        expect(afterBranch.map((revision) => revision.seq)).toEqual([5, 6, 7, 8])
        expect(stampOf(afterBranch, redoFirst.id)).not.toBeNull()
        expect(stampOf(afterBranch, redoSecond.id)).not.toBeNull()
        expect(stampOf(afterBranch, head.id)).toBeNull()
        expect(stampOf(afterBranch, branch.id)).toBeNull()

        // Two more forward saves push the window past the abandoned branch:
        // the trim deletes the live row that fell out (seq 5) while the
        // superseded rows below the window stay for audit.
        const tailRevisions: Revision[] = []
        let tail = branch.id
        for (let index = 9; index <= 10; index += 1) {
          const revision = await saveRevision(trimmed, fixture.resume.id, tail, `第${index}步`)
          tailRevisions.push(revision)
          tail = revision.id
        }
        const final = await trimmed.resumes.listRevisions(fixture.resume.id)
        expect(final.map((revision) => revision.seq)).toEqual([6, 7, 8, 9, 10])
        expect(stampOf(final, redoFirst.id)).not.toBeNull()
        expect(stampOf(final, redoSecond.id)).not.toBeNull()
        for (const revision of [branch, ...tailRevisions]) {
          expect(stampOf(final, revision.id)).toBeNull()
        }
        expect((await trimmed.resumes.findById(fixture.resume.id))?.currentRevision).toBe(tail)
      } finally {
        trimmed.close()
      }
    })
  })
}

function describeRunGateContract(flavor: Flavor): void {
  describe(`${flavor.name}: single running run gate`, () => {
    let bed: ContractBed

    beforeEach(() => {
      bed = flavor.createBed()
    })

    afterEach(() => {
      bed.close()
    })

    it('returns the run already in flight instead of storing a second one', async () => {
      const conversationId = asConversationId('conversation-1')
      await bed.conversations.insert(aConversation('conversation-1'))
      const first = aRun('run-1', conversationId)
      await expect(bed.messages.createRun(first)).resolves.toEqual(first)
      await expect(bed.runs.findById(first.id)).resolves.toEqual(first)

      // The double-send case: the caller gets the run that is already running
      // and its own run is not stored, so the conversation keeps one stream.
      const second = aRun('run-2', conversationId)
      await expect(bed.messages.createRun(second)).resolves.toEqual(first)
      await expect(bed.runs.findById(second.id)).resolves.toBeNull()

      await expect(bed.runs.findRunningByConversation(conversationId)).resolves.toEqual(first)
      await expect(bed.runs.listRunning()).resolves.toEqual([first])
    })

    it('frees the slot once the run reaches a terminal status', async () => {
      const conversationId = asConversationId('conversation-1')
      await bed.conversations.insert(aConversation('conversation-1'))
      const first = aRun('run-1', conversationId)
      await expect(bed.messages.createRun(first)).resolves.toEqual(first)

      await bed.runs.save({ ...first, status: 'completed', endedAt: LATER })

      const second = aRun('run-2', conversationId)
      await expect(bed.messages.createRun(second)).resolves.toEqual(second)
      await expect(bed.runs.findById(second.id)).resolves.toEqual(second)
    })

    it('lets a run without a conversation bypass the gate', async () => {
      // A standalone job-posting parse runs without a conversation: the
      // partial unique index treats NULL conversation ids as distinct, and the
      // memory gate skips its lookup for them, so two of these may run at once.
      const solo = aRun('run-solo-a', null)
      await expect(bed.messages.createRun(solo)).resolves.toEqual(solo)
      const another = aRun('run-solo-b', null)
      await expect(bed.messages.createRun(another)).resolves.toEqual(another)

      await expect(bed.runs.findById(solo.id)).resolves.toEqual(solo)
      await expect(bed.runs.findById(another.id)).resolves.toEqual(another)
    })
  })
}

function describeInfoEntryOrderContract(flavor: Flavor): void {
  describe(`${flavor.name}: info entry order discipline`, () => {
    let bed: ContractBed

    beforeEach(() => {
      bed = flavor.createBed()
    })

    afterEach(() => {
      bed.close()
    })

    it('refuses a duplicate entry identity and keeps the change log clean', async () => {
      await bed.entries.insert(projectEntry('entry-1', 1), aChange())
      await expect(bed.countChangeRecords()).resolves.toBe(1)

      await expect(
        bed.entries.insert(projectEntry('entry-1', 2), aChange()),
      ).rejects.toThrow()

      // The rejected write must not leave its change record behind: the log
      // claims that every stored entry is reversible.
      await expect(bed.countChangeRecords()).resolves.toBe(1)
      await expect(bed.entries.listByModule('project', null)).resolves.toHaveLength(1)
    })

    it('allows the same sort order in two different modules', async () => {
      await bed.entries.insert(projectEntry('entry-1', 1), aChange())
      await bed.entries.insert(
        infoEntryFixture({
          id: 'entry-award-1',
          moduleKind: 'award',
          fields: validRawFields('award'),
          sortOrder: 1,
        }),
        aChange({ entityId: 'entry-award-1', afterJson: JSON.stringify({ id: 'entry-award-1' }) }),
      )

      await expect(bed.entries.listAll()).resolves.toHaveLength(2)
    })

    it('rewrites the order of a module densely to one through n', async () => {
      await bed.entries.insert(projectEntry('entry-1', 1), aChange())
      await bed.entries.insert(projectEntry('entry-2', 2), aChange())
      await bed.entries.insert(projectEntry('entry-3', 3), aChange())

      await bed.entries.reorder(
        'project',
        null,
        [asInfoEntryId('entry-3'), asInfoEntryId('entry-2'), asInfoEntryId('entry-1')],
        aChange({ op: 'infoEntry.reorder' }),
      )

      const stored = await bed.entries.listByModule('project', null)
      expect(stored.map((entry) => [entry.id, entry.sortOrder])).toEqual([
        ['entry-3', 1],
        ['entry-2', 2],
        ['entry-1', 3],
      ])
    })

    it('refuses a reorder whose identifier set does not match the module', async () => {
      await bed.entries.insert(projectEntry('entry-1', 1), aChange())
      await bed.entries.insert(projectEntry('entry-2', 2), aChange())

      await expect(
        bed.entries.reorder('project', null, [asInfoEntryId('entry-2')], aChange()),
      ).rejects.toThrow()
      await expect(
        bed.entries.reorder(
          'project',
          null,
          [asInfoEntryId('entry-1'), asInfoEntryId('missing')],
          aChange(),
        ),
      ).rejects.toThrow()
      await expect(
        bed.entries.reorder(
          'project',
          null,
          [asInfoEntryId('entry-1'), asInfoEntryId('entry-1')],
          aChange(),
        ),
      ).rejects.toThrow()

      // Every refusal happened before any position moved.
      const stored = await bed.entries.listByModule('project', null)
      expect(stored.map((entry) => entry.sortOrder)).toEqual([1, 2])
    })
  })
}

for (const flavor of FLAVORS) {
  describeResumeContract(flavor)
  describeRunGateContract(flavor)
  describeInfoEntryOrderContract(flavor)
}

describe('shared defaults', () => {
  it('keeps one default revision limit for both implementations', () => {
    // The trim window is a contract, not an implementation detail: the two
    // constants must move together, or one store silently keeps a different
    // amount of history than the other.
    expect(IN_MEMORY_REVISION_LIMIT).toBe(SQLITE_REVISION_LIMIT)
    expect(SQLITE_REVISION_LIMIT).toBe(200)
  })
})

/**
 * Behaviour the two flavors do not share. Each case pins what its flavor does
 * today; the port the case exercises declares the shared rule, so a divergence
 * here is a known gap of one implementation rather than a second contract.
 */
describe('documented divergences between the flavors', () => {
  describe('sqlite repositories', () => {
    let bed: ContractBed

    beforeEach(() => {
      bed = createSqliteBed()
    })

    afterEach(() => {
      bed.close()
    })

    it('backs the raw create path with the partial unique index', async () => {
      // The gate on createRun consults the running row and returns the winner;
      // a raw AgentRunRepository.create bypasses that check, and
      // idx_run_one_running is what refuses a second running run. The memory
      // store has no index, so only its createRun gate enforces the rule.
      await bed.conversations.insert(aConversation('conversation-1'))
      await bed.runs.create(aRun('run-1', asConversationId('conversation-1')))

      await expect(
        bed.runs.create(aRun('run-2', asConversationId('conversation-1'))),
      ).rejects.toThrow(/UNIQUE constraint failed/u)
    })

    it('refuses a second entry on a sort order the module already uses', async () => {
      // The port declares the sort order unique inside a module; the SQLite
      // schema enforces it with idx_info_entry_order. The memory store enforces
      // no such index and accepts the duplicate (see the in-memory case below).
      await bed.entries.insert(projectEntry('entry-1', 1), aChange())

      await expect(
        bed.entries.insert(projectEntry('entry-2', 1), aChange()),
      ).rejects.toThrow()
      await expect(bed.countChangeRecords()).resolves.toBe(1)
    })
  })

  describe('in-memory repositories', () => {
    let bed: ContractBed

    beforeEach(() => {
      bed = createInMemoryBed()
    })

    afterEach(() => {
      bed.close()
    })

    it('leaves the raw create path unguarded', async () => {
      // Divergence from SQLite: the map-backed store has no index, so only the
      // createRun gate enforces the single-running rule and a raw create
      // accepts a second running run. This pins today's behaviour.
      await bed.conversations.insert(aConversation('conversation-1'))
      await bed.runs.create(aRun('run-1', asConversationId('conversation-1')))

      await expect(
        bed.runs.create(aRun('run-2', asConversationId('conversation-1'))),
      ).resolves.toBeUndefined()
      await expect(bed.runs.findById(asAgentRunId('run-2'))).resolves.not.toBeNull()
      await expect(bed.runs.listRunning()).resolves.toHaveLength(2)
    })

    it('accepts a second entry on a sort order the module already uses', async () => {
      // Divergence from SQLite and from the port's declared rule: the
      // map-backed store enforces no order index and only refuses a duplicate
      // entry identity, so the duplicate sort order is stored. This pins
      // today's behaviour.
      await bed.entries.insert(projectEntry('entry-1', 1), aChange())
      await bed.entries.insert(projectEntry('entry-2', 1), aChange())

      await expect(bed.entries.listByModule('project', null)).resolves.toHaveLength(2)
    })
  })
})
