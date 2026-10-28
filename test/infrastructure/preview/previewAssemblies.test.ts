/**
 * @file previewAssemblies.test
 * @description The memory-backed implementations the preview window is built
 * from: deterministic time and identifiers, a scripted model stream, the file
 * store's name rule, and the provider table.
 */

import { describe, expect, it } from 'vitest'

import type { ModelChunk } from '../../../src/domain/generation/ports/ModelProvider'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { InMemoryFileStore } from '../../../src/infrastructure/preview/InMemoryFileStore'
import { NoopPdfSaver } from '../../../src/infrastructure/preview/NoopPdfSaver'
import {
  InMemoryProviderConfigRepository,
  InMemorySecretStore,
} from '../../../src/infrastructure/preview/inMemoryRepositories'
import { ScriptedModelProvider } from '../../../src/infrastructure/preview/ScriptedModelProvider'
import {
  FakeClock,
  PREVIEW_EPOCH,
  SequentialIdGenerator,
} from '../../../src/infrastructure/preview/deterministicEnvironment'
import { PREVIEW_SCRIPT } from '../../../src/infrastructure/preview/fixtures'
import {
  PREVIEW_CONVERSATION_ID,
  PREVIEW_OLDER_CONVERSATION_ID,
  PREVIEW_PINNED_CONVERSATION_ID,
  PREVIEW_RUN_ID,
  PREVIEW_TOOL_CHAIN_TURNS,
} from '../../../src/infrastructure/preview/fixtures.conversation'
import { createPreviewConversationService } from '../../../src/bootstrap/previewConversation'

async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> {
  const chunks: ModelChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('deterministicEnvironment', () => {
  it('advances one second per read from a fixed epoch', () => {
    const clock = new FakeClock()
    expect(clock.now()).toBe(PREVIEW_EPOCH)
    expect(clock.now()).toBe('2026-01-01T00:00:01.000Z')
  })

  it('counts identifiers up', () => {
    const ids = new SequentialIdGenerator('entry')
    expect(ids.next()).toBe('entry-1')
    expect(ids.next()).toBe('entry-2')
  })
})

describe('ScriptedModelProvider', () => {
  it('replays the script in order', async () => {
    const provider = new ScriptedModelProvider({ script: PREVIEW_SCRIPT })

    const chunks = await collect(provider.stream({ system: null, messages: [] }, []))

    expect(chunks).toEqual([...PREVIEW_SCRIPT])
  })

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController()
    const provider = new ScriptedModelProvider({
      script: PREVIEW_SCRIPT,
      pause: async () => {
        controller.abort()
      },
    })

    const chunks = await collect(provider.stream({ system: null, messages: [] }, [], controller.signal))

    expect(chunks.length).toBeLessThan(PREVIEW_SCRIPT.length)
  })
})

describe('InMemoryFileStore', () => {
  it('round-trips bytes and lists the stored names in order', async () => {
    const store = new InMemoryFileStore()
    await store.write('b.png', new Uint8Array([2]))
    await store.write('a.png', new Uint8Array([1]))

    await expect(store.read('b.png')).resolves.toEqual(new Uint8Array([2]))
    await expect(store.list()).resolves.toEqual(['a.png', 'b.png'])
  })

  it('refuses a name that carries a path separator', async () => {
    const store = new InMemoryFileStore()
    await expect(store.write('../escape.png', new Uint8Array([1]))).rejects.toThrow(
      /path separator/,
    )
  })

  it('reports an unknown name', async () => {
    const store = new InMemoryFileStore()
    await expect(store.read('missing.png')).rejects.toThrow(/No preview attachment/)
  })
})

describe('NoopPdfSaver', () => {
  it('reports the save as dismissed', async () => {
    const saver = new NoopPdfSaver()
    await expect(saver.save(new Uint8Array([1]), 'resume.pdf')).resolves.toBeNull()
  })
})

describe('InMemoryProviderConfigRepository', () => {
  it('keeps one active provider', async () => {
    const repository = new InMemoryProviderConfigRepository()
    const timestamp = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
    const base = {
      kind: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com',
      modelId: 'model',
      secretRef: 'provider:one',
      supportsImages: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await repository.upsert({ ...base, id: 'one', name: 'One', isActive: true })
    await repository.upsert({ ...base, id: 'two', name: 'Two', isActive: false })

    await repository.setActive('two')

    await expect(repository.findActive()).resolves.toMatchObject({ id: 'two' })
    await repository.setActive(null)
    await expect(repository.findActive()).resolves.toBeNull()
  })
})

describe('InMemorySecretStore', () => {
  it('returns null for a reference that was never stored', async () => {
    const store = new InMemorySecretStore()
    await expect(store.load('provider:missing')).resolves.toBeNull()
  })
})

describe('the preview conversation assembly', () => {
  it('serves the seeded conversations, transcript and run', async () => {
    const { service } = createPreviewConversationService()

    const listed = await service.listConversations()
    expect(listed.conversations.map((conversation) => conversation.id)).toEqual([
      PREVIEW_PINNED_CONVERSATION_ID,
      PREVIEW_CONVERSATION_ID,
      PREVIEW_OLDER_CONVERSATION_ID,
    ])
    const messages = await service.listMessages(PREVIEW_CONVERSATION_ID, 10)
    expect(messages.map((message) => message.kind)).toEqual([
      'user',
      'tool',
      'tool',
      'assistant',
    ])
    expect(messages.every((message) => message.runId === PREVIEW_RUN_ID || message.seq === 1)).toBe(
      true,
    )
  })

  it('runs the scripted end-to-end tool chain', async () => {
    const { service, state } = createPreviewConversationService({
      turns: PREVIEW_TOOL_CHAIN_TURNS,
    })
    const events: string[] = []
    const run = await service.runTurn(
      {
        conversationId: PREVIEW_CONVERSATION_ID,
        userMessage: {
          conversationId: PREVIEW_CONVERSATION_ID,
          kind: 'user',
          markdown: '帮我按这个岗位整理一份简历。',
        },
        model: null,
        activeResumeId: null,
      },
      (event) => {
        events.push(event.type)
      },
    )

    expect(run.status).toBe('completed')
    expect(events[0]).toBe('runStarted')
    expect(events.at(-1)).toBe('done')
    expect(events).toContain('toolStart')
    expect(events).toContain('toolEnd')

    const messages = await service.listMessages(PREVIEW_CONVERSATION_ID, 40)
    const assistant = [...messages].reverse().find((message) => message.kind === 'assistant')
    expect(assistant?.markdown).toContain('完成这一轮简历整理')
    expect(assistant?.status).toBe('complete')

    // The tools really wrote: one posting, one resume and the audit rows of the
    // chain are all in the shared memory state.
    const postings = await state.jobPostings.listRecent(10)
    expect(postings).toHaveLength(1)
    expect(postings[0]?.parsedByRunId).not.toBeNull()
    const resumes = await state.resumes.listAll()
    const created = resumes.find((resume) => resume.title === '后端开发工程师简历')
    expect(created).toBeDefined()
    const invocations = await state.invocations.listByRun(run.id)
    expect(invocations.length).toBeGreaterThanOrEqual(6)
    expect(invocations.every((invocation) => invocation.status === 'ok')).toBe(true)
  })

  it('creates, renames and deletes conversations against the same memory store', async () => {
    const { service } = createPreviewConversationService()
    const created = await service.createConversation({ title: '预览会话' })
    const renamed = await service.renameConversation({
      conversationId: created.id,
      title: '重命名后的会话',
    })
    expect(renamed.title).toBe('重命名后的会话')
    await service.deleteConversation({ conversationId: created.id })
    const listed = await service.listConversations()
    expect(listed.conversations.map((conversation) => conversation.id)).toEqual([
      PREVIEW_PINNED_CONVERSATION_ID,
      PREVIEW_CONVERSATION_ID,
      PREVIEW_OLDER_CONVERSATION_ID,
    ])
  })
})
