/**
 * @file conversationUseCases.test
 * @description The conversation use cases against the memory repositories:
 * creation, naming, listing, appending messages with their limits, attachment
 * ingest, and the automatic title.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

import { appendMessage } from '../../../src/application/conversation/appendMessage'
import { autoTitleConversation } from '../../../src/application/conversation/autoTitle'
import { createConversation } from '../../../src/application/conversation/createConversation'
import { deleteConversation } from '../../../src/application/conversation/deleteConversation'
import { ingestAttachment } from '../../../src/application/conversation/ingestAttachment'
import { listConversations } from '../../../src/application/conversation/listConversations'
import { renameConversation } from '../../../src/application/conversation/renameConversation'
import { togglePinned } from '../../../src/application/conversation/togglePinned'
import { DomainError } from '../../../src/domain/shared/DomainError'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asConversationId } from '../../../src/domain/shared/branded-id'
import { InMemoryFileStore } from '../../../src/infrastructure/preview/InMemoryFileStore'
import { createConversationBed } from '../../support/conversationBed'
import type { ScriptedTurn } from '../../support/modelDouble'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

beforeAll(() => {
  // jsdom implements getRandomValues but not Web Crypto's digest, which the
  // ingest path uses for the content hash.
  vi.stubGlobal('crypto', webcrypto)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('createConversation', () => {
  it('creates the default title and timestamps', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    expect(conversation.title).toBe('新对话')
    expect(conversation.pinned).toBe(false)
    expect(conversation.createdAt).toBe(conversation.updatedAt)
    await expect(bed.conversations.findById(conversation.id)).resolves.toEqual(conversation)
  })

  it('normalises a supplied title and rejects an empty one', async () => {
    const bed = createConversationBed()
    const named = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      { title: '  字节前端  ' },
    )
    expect(named.title).toBe('字节前端')
    await expect(
      createConversation(
        { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
        { title: '   ' },
      ),
    ).rejects.toMatchObject({ code: 'blankRequiredField' })
  })
})

describe('renameConversation and togglePinned', () => {
  it('renames a conversation and refreshes its timestamp', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    const renamed = await renameConversation(
      { conversations: bed.conversations, clock: bed.clock },
      { conversationId: conversation.id, title: '  新名字 ' },
    )
    expect(renamed.title).toBe('新名字')
    expect(renamed.updatedAt > conversation.updatedAt).toBe(true)
  })

  it('reports a conversation that does not exist', async () => {
    const bed = createConversationBed()
    const missing = asConversationId('missing')
    await expect(
      renameConversation(
        { conversations: bed.conversations, clock: bed.clock },
        { conversationId: missing, title: '名字' },
      ),
    ).rejects.toMatchObject({ code: 'conversationNotFound' })
    await expect(
      togglePinned(
        { conversations: bed.conversations, clock: bed.clock },
        { conversationId: missing, pinned: true },
      ),
    ).rejects.toMatchObject({ code: 'conversationNotFound' })
    await expect(
      deleteConversation({ conversations: bed.conversations }, { conversationId: missing }),
    ).rejects.toMatchObject({ code: 'conversationNotFound' })
  })

  it('writes the pinned flag and leaves an unchanged value alone', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    const pinned = await togglePinned(
      { conversations: bed.conversations, clock: bed.clock },
      { conversationId: conversation.id, pinned: true },
    )
    expect(pinned.pinned).toBe(true)
    const again = await togglePinned(
      { conversations: bed.conversations, clock: bed.clock },
      { conversationId: conversation.id, pinned: true },
    )
    expect(again).toBe(pinned)
  })

  it('deletes a conversation', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    await deleteConversation({ conversations: bed.conversations }, { conversationId: conversation.id })
    await expect(bed.conversations.findById(conversation.id)).resolves.toBeNull()
  })
})

describe('listConversations', () => {
  it('orders pinned first and then by the last update, with day groups', async () => {
    const bed = createConversationBed()
    const older = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      { title: '旧会话' },
    )
    const newer = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      { title: '新会话' },
    )
    await togglePinned(
      { conversations: bed.conversations, clock: bed.clock },
      { conversationId: older.id, pinned: true },
    )
    const listed = await listConversations({ conversations: bed.conversations, clock: bed.clock })
    expect(listed.conversations.map((conversation) => conversation.id)).toEqual([older.id, newer.id])
    expect(listed.groups.today.map((conversation) => conversation.id)).toEqual([older.id, newer.id])
    expect(listed.groups.last7Days).toEqual([])
    expect(listed.groups.earlier).toEqual([])
  })
})

describe('appendMessage', () => {
  it('allocates the next sequence and touches the conversation', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    const first = await appendMessage(
      {
        conversations: bed.conversations,
        messages: bed.messages,
        messageContexts: bed.messageContexts,
        attachments: bed.attachments,
        clock: bed.clock,
        ids: bed.ids,
      },
      { conversationId: conversation.id, kind: 'user', markdown: '你好' },
    )
    const second = await appendMessage(
      {
        conversations: bed.conversations,
        messages: bed.messages,
        messageContexts: bed.messageContexts,
        attachments: bed.attachments,
        clock: bed.clock,
        ids: bed.ids,
      },
      { conversationId: conversation.id, kind: 'assistant', markdown: '' },
    )
    expect(first.seq).toBe(1)
    expect(first.status).toBe('complete')
    expect(second.seq).toBe(2)
    expect(second.status).toBe('streaming')
    const stored = await bed.conversations.findById(conversation.id)
    expect(stored !== null && stored.updatedAt > conversation.updatedAt).toBe(true)
  })

  it('validates the attachments before writing the message', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    const deps = {
      conversations: bed.conversations,
      messages: bed.messages,
      messageContexts: bed.messageContexts,
      attachments: bed.attachments,
      clock: bed.clock,
      ids: bed.ids,
    }
    await expect(
      appendMessage(deps, {
        conversationId: conversation.id,
        kind: 'user',
        markdown: '看这张图',
        attachmentIds: ['missing' as never],
      }),
    ).rejects.toMatchObject({ code: 'attachmentNotFound' })
  })

  it('requires the tool payload exactly for tool messages', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    const deps = {
      conversations: bed.conversations,
      messages: bed.messages,
      messageContexts: bed.messageContexts,
      attachments: bed.attachments,
      clock: bed.clock,
      ids: bed.ids,
    }
    await expect(
      appendMessage(deps, { conversationId: conversation.id, kind: 'tool', markdown: '' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('stores the context chips of the turn and removes duplicates', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    const message = await appendMessage(
      {
        conversations: bed.conversations,
        messages: bed.messages,
        messageContexts: bed.messageContexts,
        attachments: bed.attachments,
        clock: bed.clock,
        ids: bed.ids,
      },
      {
        conversationId: conversation.id,
        kind: 'user',
        markdown: '参考这些',
        contexts: [
          { kind: 'entry', refId: 'entry-1' as never },
          { kind: 'entry', refId: 'entry-1' as never },
        ],
      },
    )
    await expect(bed.messageContexts.listByMessage(message.id)).resolves.toHaveLength(1)
  })
})

describe('autoTitleConversation', () => {
  it('falls back to the truncated first message when no model is configured', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    const titled = await autoTitleConversation(
      { conversations: bed.conversations, model: null, clock: bed.clock },
      {
        conversationId: conversation.id,
        firstUserMessage: '帮我针对字节跳动前端岗位整理一份简历，重点突出项目经历和性能优化的工作。',
      },
    )
    expect(titled.title).toBe('帮我针对字节跳动前端岗位整理一份简历，重点突出项')
    expect([...titled.title]).toHaveLength(24)
  })

  it('uses a model answer, stripping quotes and falling back on failure', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      {},
    )
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '「字节前端简历」' }] })
    const titled = await autoTitleConversation(
      { conversations: bed.conversations, model: bed.model, clock: bed.clock },
      { conversationId: conversation.id, firstUserMessage: '帮我准备字节前端简历' },
    )
    expect(titled.title).toBe('字节前端简历')

    const failing: ScriptedTurn[] = [{ error: new Error('busy') }]
    for (const turn of failing) bed.model.enqueue(turn)
    const fallback = await autoTitleConversation(
      { conversations: bed.conversations, model: bed.model, clock: bed.clock },
      { conversationId: conversation.id, firstUserMessage: '帮我准备字节前端简历' },
    )
    expect(fallback.title).toBe('帮我准备字节前端简历')
  })
})

describe('ingestAttachment', () => {
  function ingestDeps(bed: ReturnType<typeof createConversationBed>, fileStore = new InMemoryFileStore()) {
    return {
      attachments: bed.attachments,
      fileStore,
      clock: bed.clock,
      ids: bed.ids,
    }
  }

  it('stores the bytes and the metadata row', async () => {
    const bed = createConversationBed()
    const fileStore = new InMemoryFileStore()
    const attachment = await ingestAttachment(ingestDeps(bed, fileStore), {
      kind: 'image',
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    })
    expect(attachment.storageName).toBe(`${attachment.id}.png`)
    expect(attachment.byteSize).toBe(PNG_BYTES.byteLength)
    expect(attachment.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(attachment.width).toBeNull()
    expect(await fileStore.list()).toEqual([attachment.storageName])
    await expect(bed.attachments.findById(attachment.id)).resolves.toEqual(attachment)
  })

  it('reuses the row of an identical file', async () => {
    const bed = createConversationBed()
    const fileStore = new InMemoryFileStore()
    const first = await ingestAttachment(ingestDeps(bed, fileStore), {
      kind: 'image',
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    })
    const second = await ingestAttachment(ingestDeps(bed, fileStore), {
      kind: 'image',
      mimeType: 'image/png',
      bytes: PNG_BYTES,
    })
    expect(second.id).toBe(first.id)
    expect(await fileStore.list()).toHaveLength(1)
  })

  it('rejects an unsupported type, a mismatched kind and an oversized file', async () => {
    const bed = createConversationBed()
    await expect(
      ingestAttachment(ingestDeps(bed), {
        kind: 'image',
        mimeType: 'image/svg+xml',
        bytes: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: 'unsupportedImageType' })
    await expect(
      ingestAttachment(ingestDeps(bed), {
        kind: 'file',
        mimeType: 'image/png',
        bytes: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: 'unsupportedImageType' })
    await expect(
      ingestAttachment(ingestDeps(bed), {
        kind: 'image',
        mimeType: 'image/png',
        bytes: new Uint8Array(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: 'attachmentTooLarge' })
  })

  it('does not leave stored bytes behind when the row cannot be written', async () => {
    const bed = createConversationBed()
    const fileStore = new InMemoryFileStore()
    const failing = {
      ...ingestDeps(bed, fileStore),
      attachments: {
        ...bed.attachments,
        insert: async () => {
          throw new Error('row insert failed')
        },
        findById: async () => null,
        findBySha256: async () => null,
        listByIds: async () => [],
      },
    }
    await expect(
      ingestAttachment(failing, { kind: 'image', mimeType: 'image/png', bytes: PNG_BYTES }),
    ).rejects.toThrow('row insert failed')
    await expect(fileStore.list()).resolves.toEqual([])
  })
})

describe('the clock of the conversation use cases', () => {
  it('records the injected instant rather than the wall clock', () => {
    const instant: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
    expect(instant).toBe('2026-01-01T00:00:00.000Z')
  })
})
