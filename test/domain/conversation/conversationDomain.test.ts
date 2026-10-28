/**
 * @file conversationDomain.test
 * @description The invariants of the conversation aggregates: title rules,
 * sidebar grouping, the message status machine, attachment limits and the
 * context-chip kinds.
 */

import { describe, expect, it } from 'vitest'

import {
  CONVERSATION_TITLE_MAX_LENGTH,
  conversationGroupFor,
  normaliseConversationTitle,
  truncatedConversationTitle,
} from '../../../src/domain/conversation/Conversation'
import {
  assertMessageStatusChange,
  assertToolPayloadMatchesKind,
  initialMessageStatus,
  truncateToolDetail,
} from '../../../src/domain/conversation/Message'
import {
  assertAttachmentAllowed,
  assertMessageAttachmentsAllowed,
  attachmentKindForMime,
  attachmentStorageName,
  isAttachmentMimeType,
  MAX_ATTACHMENT_BYTE_SIZE,
  MAX_MESSAGE_ATTACHMENT_BYTE_SIZE,
} from '../../../src/domain/conversation/Attachment'
import { isMessageContextKind } from '../../../src/domain/conversation/MessageContext'
import { DomainError } from '../../../src/domain/shared/DomainError'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import { asAttachmentId } from '../../../src/domain/shared/branded-id'

const AT: DateTime = parseDateTime('2026-01-15T12:00:00.000Z') as DateTime

function aPayload() {
  return {
    toolName: 'searchInfoEntries',
    invocationId: null,
    risk: 'read' as const,
    label: '检索',
    detail: '',
    changeIds: [],
    revisionId: null,
    resumeId: null,
  }
}

describe('conversation titles', () => {
  it('trims and validates a user title', () => {
    expect(normaliseConversationTitle('  周报整理  ')).toBe('周报整理')
    expect(() => normaliseConversationTitle('   ')).toThrow(DomainError)
    expect(() => normaliseConversationTitle('长'.repeat(CONVERSATION_TITLE_MAX_LENGTH + 1))).toThrow(
      DomainError,
    )
    // The limit counts code points, not UTF-16 units.
    expect(normaliseConversationTitle('😀'.repeat(CONVERSATION_TITLE_MAX_LENGTH))).toBe(
      '😀'.repeat(CONVERSATION_TITLE_MAX_LENGTH),
    )
  })

  it('truncates the fallback title by code point', () => {
    expect(truncatedConversationTitle('帮我写一份简历', 24)).toBe('帮我写一份简历')
    expect(truncatedConversationTitle('a'.repeat(30), 24)).toHaveLength(24)
    expect(truncatedConversationTitle('😀'.repeat(30), 24)).toBe('😀'.repeat(24))
  })
})

describe('sidebar grouping', () => {
  it('groups by UTC calendar day distance', () => {
    expect(conversationGroupFor(AT, AT)).toBe('today')
    expect(conversationGroupFor('2026-01-14T23:00:00.000Z' as DateTime, AT)).toBe('last7Days')
    expect(conversationGroupFor('2026-01-01T00:00:00.000Z' as DateTime, AT)).toBe('earlier')
  })
})

describe('the message status machine', () => {
  it('starts each kind in its documented status', () => {
    expect(initialMessageStatus('user')).toBe('complete')
    expect(initialMessageStatus('assistant')).toBe('streaming')
    expect(initialMessageStatus('tool')).toBe('running')
  })

  it('allows only the documented transitions', () => {
    expect(() => assertMessageStatusChange('assistant', 'streaming', 'complete')).not.toThrow()
    expect(() => assertMessageStatusChange('assistant', 'streaming', 'cancelled')).not.toThrow()
    expect(() => assertMessageStatusChange('assistant', 'streaming', 'failed')).not.toThrow()
    expect(() => assertMessageStatusChange('tool', 'running', 'complete')).not.toThrow()
    expect(() => assertMessageStatusChange('tool', 'running', 'failed')).not.toThrow()
    // The streamed text is persisted repeatedly while the status stays put.
    expect(() => assertMessageStatusChange('assistant', 'streaming', 'streaming')).not.toThrow()
    expect(() => assertMessageStatusChange('assistant', 'complete', 'streaming')).toThrow(DomainError)
    expect(() => assertMessageStatusChange('user', 'complete', 'cancelled')).toThrow(DomainError)
    expect(() => assertMessageStatusChange('tool', 'running', 'cancelled')).toThrow(DomainError)
  })

  it('binds the tool payload to the tool kind', () => {
    expect(() => assertToolPayloadMatchesKind('tool', aPayload())).not.toThrow()
    expect(() => assertToolPayloadMatchesKind('user', null)).not.toThrow()
    expect(() => assertToolPayloadMatchesKind('tool', null)).toThrow(DomainError)
    expect(() => assertToolPayloadMatchesKind('assistant', aPayload())).toThrow(DomainError)
    expect(truncateToolDetail('x'.repeat(2500))).toHaveLength(2000)
  })
})

describe('attachment limits', () => {
  it('accepts the supported MIME types and derives the kind', () => {
    expect(isAttachmentMimeType('image/png')).toBe(true)
    expect(isAttachmentMimeType('text/html')).toBe(false)
    expect(attachmentKindForMime('image/webp')).toBe('image')
    expect(attachmentKindForMime('application/pdf')).toBe('file')
    expect(attachmentKindForMime('image/svg+xml')).toBeNull()
  })

  it('builds the storage name from the identifier and the extension', () => {
    expect(attachmentStorageName(asAttachmentId('a1'), 'image/jpeg')).toBe('a1.jpg')
    expect(attachmentStorageName(asAttachmentId('a1'), 'application/pdf')).toBe('a1.pdf')
  })

  it('rejects an unsupported type, an empty file and an oversized one', () => {
    expect(() => assertAttachmentAllowed('image/png', 10)).not.toThrow()
    expect(() => assertAttachmentAllowed('image/svg+xml', 10)).toThrow(DomainError)
    expect(() => assertAttachmentAllowed('image/png', 0)).toThrow(DomainError)
    expect(() =>
      assertAttachmentAllowed('image/png', MAX_ATTACHMENT_BYTE_SIZE + 1),
    ).toThrow(DomainError)
  })

  it('rejects too many attachments and too much combined weight on one message', () => {
    expect(() =>
      assertMessageAttachmentsAllowed(
        Array.from({ length: 5 }, () => ({ mimeType: 'image/png', byteSize: 10 })),
      ),
    ).toThrow(DomainError)
    expect(() =>
      assertMessageAttachmentsAllowed([
        { mimeType: 'image/png', byteSize: MAX_MESSAGE_ATTACHMENT_BYTE_SIZE },
        { mimeType: 'image/png', byteSize: 1 },
      ]),
    ).toThrow(DomainError)
    expect(() =>
      assertMessageAttachmentsAllowed([{ mimeType: 'image/png', byteSize: 10 }]),
    ).not.toThrow()
  })
})

describe('message context kinds', () => {
  it('accepts exactly the three kinds', () => {
    expect(isMessageContextKind('entry')).toBe(true)
    expect(isMessageContextKind('resume')).toBe(true)
    expect(isMessageContextKind('jobPosting')).toBe(true)
    expect(isMessageContextKind('job')).toBe(false)
  })
})
