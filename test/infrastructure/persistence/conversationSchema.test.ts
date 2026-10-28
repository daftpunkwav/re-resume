/**
 * @file conversationSchema.test
 * @description Version 8's conversation tables on a real SQLite database: the
 * constraints the schema owns (identity of a message sequence, the tool-card
 * CHECK, one running run per conversation) and the foreign-key behaviour the
 * application relies on (cascade on conversation delete, RESTRICT on an
 * attachment an earlier migration left behind).
 *
 * The migration is applied on top of versions 1 to 3, because a fresh database
 * runs it in that order.
 */

import { describe, expect, it } from 'vitest'

import {
  createMigratedDatabase,
  foreignKeyViolations,
} from '../../support/nodeSqliteDatabase'
import type { NodeSqliteDatabase } from '../../support/nodeSqliteDatabase'

const AT = '2026-01-01T00:00:00.000Z'

const TOOL_PAYLOAD = JSON.stringify({
  v: 1,
  data: {
    toolName: 'searchInfoEntries',
    invocationId: null,
    risk: 'read',
    label: '检索信息条目',
    detail: '',
    changeIds: [],
    revisionId: null,
    resumeId: null,
  },
})

async function insertConversation(database: NodeSqliteDatabase, id = 'conversation-1'): Promise<void> {
  await database.execute(
    `INSERT INTO conversation (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4)`,
    [id, '新对话', AT, AT],
  )
}

async function insertMessage(
  database: NodeSqliteDatabase,
  values: {
    readonly id: string
    readonly conversationId?: string
    readonly seq: number
    readonly kind: string
    readonly status: string
    readonly toolJson?: string | null
  },
): Promise<void> {
  await database.execute(
    `INSERT INTO message (id, conversation_id, seq, kind, status, markdown, tool_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8)`,
    [
      values.id,
      values.conversationId ?? 'conversation-1',
      values.seq,
      values.kind,
      values.status,
      values.toolJson ?? null,
      AT,
      AT,
    ],
  )
}

describe('the conversation schema', () => {
  it('rejects a second message with the same sequence in one conversation', async () => {
    const database = createMigratedDatabase()
    await insertConversation(database)
    await insertMessage(database, { id: 'message-1', seq: 1, kind: 'user', status: 'complete' })

    await expect(
      insertMessage(database, { id: 'message-2', seq: 1, kind: 'user', status: 'complete' }),
    ).rejects.toThrow()

    // The same sequence in another conversation is a different message.
    await insertConversation(database, 'conversation-2')
    await expect(
      insertMessage(database, {
        id: 'message-3',
        conversationId: 'conversation-2',
        seq: 1,
        kind: 'user',
        status: 'complete',
      }),
    ).resolves.toBeUndefined()
  })

  it('requires a tool payload exactly for tool messages', async () => {
    const database = createMigratedDatabase()
    await insertConversation(database)

    await expect(
      insertMessage(database, { id: 'tool-1', seq: 1, kind: 'tool', status: 'running' }),
    ).rejects.toThrow()
    await expect(
      insertMessage(database, {
        id: 'user-1',
        seq: 2,
        kind: 'user',
        status: 'complete',
        toolJson: TOOL_PAYLOAD,
      }),
    ).rejects.toThrow()
    await expect(
      insertMessage(database, {
        id: 'tool-2',
        seq: 3,
        kind: 'tool',
        status: 'running',
        toolJson: TOOL_PAYLOAD,
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects a status outside the closed set', async () => {
    const database = createMigratedDatabase()
    await insertConversation(database)
    await expect(
      insertMessage(database, { id: 'm-1', seq: 1, kind: 'assistant', status: 'awaiting' }),
    ).rejects.toThrow()
  })

  it('allows one running run per conversation', async () => {
    const database = createMigratedDatabase()
    await insertConversation(database)
    await database.execute(
      `INSERT INTO agent_run (id, conversation_id, status, started_at) VALUES ($1, $2, 'running', $3)`,
      ['run-1', 'conversation-1', AT],
    )
    await expect(
      database.execute(
        `INSERT INTO agent_run (id, conversation_id, status, started_at) VALUES ($1, $2, 'running', $3)`,
        ['run-2', 'conversation-1', AT],
      ),
    ).rejects.toThrow()

    // A standalone parse has no conversation, and NULLs do not collide.
    await database.execute(
      `INSERT INTO agent_run (id, conversation_id, status, started_at) VALUES ($1, NULL, 'running', $2)`,
      ['run-3', AT],
    )
    await database.execute(
      `INSERT INTO agent_run (id, conversation_id, status, started_at) VALUES ($1, NULL, 'running', $2)`,
      ['run-4', AT],
    )
    // A finished run frees the slot.
    await database.execute(`UPDATE agent_run SET status = 'completed', ended_at = $1 WHERE id = 'run-1'`, [AT])
    await expect(
      database.execute(
        `INSERT INTO agent_run (id, conversation_id, status, started_at) VALUES ($1, $2, 'running', $3)`,
        ['run-5', 'conversation-1', AT],
      ),
    ).resolves.toBeDefined()
  })

  it('deletes the transcript with its conversation but keeps the attachment row', async () => {
    const database = createMigratedDatabase()
    await insertConversation(database)
    await database.execute(
      `INSERT INTO attachment (id, kind, mime_type, byte_size, storage_name, sha256, created_at)
       VALUES ('attachment-1', 'image', 'image/png', 4, 'attachment-1.png', $1, $2)`,
      ['a'.repeat(64), AT],
    )
    await insertMessage(database, { id: 'message-1', seq: 1, kind: 'user', status: 'complete' })
    await database.execute(
      `INSERT INTO message_attachment (message_id, attachment_id, position) VALUES ('message-1', 'attachment-1', 0)`,
    )
    await database.execute(
      `INSERT INTO message_context (message_id, kind, ref_id, position) VALUES ('message-1', 'entry', 'entry-1', 0)`,
    )

    await database.execute(`DELETE FROM conversation WHERE id = 'conversation-1'`)

    const messages = await database.select('SELECT id FROM message')
    const links = await database.select('SELECT message_id FROM message_attachment')
    const contexts = await database.select('SELECT message_id FROM message_context')
    expect(messages).toEqual([])
    expect(links).toEqual([])
    expect(contexts).toEqual([])
    // The attachment is shared storage: another message or a canvas block may
    // still name it, so deleting the conversation must not remove it.
    await expect(database.select('SELECT id FROM attachment')).resolves.toHaveLength(1)
    expect(await foreignKeyViolations(database)).toEqual([])
  })

  it('refuses to delete an attachment a message still references', async () => {
    const database = createMigratedDatabase()
    await insertConversation(database)
    await database.execute(
      `INSERT INTO attachment (id, kind, mime_type, byte_size, storage_name, sha256, created_at)
       VALUES ('attachment-1', 'image', 'image/png', 4, 'attachment-1.png', $1, $2)`,
      ['a'.repeat(64), AT],
    )
    await insertMessage(database, { id: 'message-1', seq: 1, kind: 'user', status: 'complete' })
    await database.execute(
      `INSERT INTO message_attachment (message_id, attachment_id, position) VALUES ('message-1', 'attachment-1', 0)`,
    )

    await expect(database.execute(`DELETE FROM attachment WHERE id = 'attachment-1'`)).rejects.toThrow()
  })

  it('cascades a run to its tool invocations', async () => {
    const database = createMigratedDatabase()
    await insertConversation(database)
    await database.execute(
      `INSERT INTO agent_run (id, conversation_id, status, started_at) VALUES ('run-1', 'conversation-1', 'completed', $1)`,
      [AT],
    )
    await database.execute(
      `INSERT INTO tool_invocation (id, run_id, tool_name, risk, args_json, status, created_at)
       VALUES ('invocation-1', 'run-1', 'searchInfoEntries', 'read', '{"v":1,"data":"{}"}', 'ok', $1)`,
      [AT],
    )

    await database.execute(`DELETE FROM agent_run WHERE id = 'run-1'`)
    await expect(database.select('SELECT id FROM tool_invocation')).resolves.toEqual([])
  })

  it('requires a posting to carry text or images', async () => {
    const database = createMigratedDatabase()
    await expect(
      database.execute(
        `INSERT INTO job_posting (id, raw_text, image_attachment_ids, created_at)
         VALUES ('posting-empty', '', '{"v":1,"data":[]}', $1)`,
        [AT],
      ),
    ).rejects.toThrow()
    await expect(
      database.execute(
        `INSERT INTO job_posting (id, raw_text, image_attachment_ids, created_at)
         VALUES ('posting-text', '招聘前端工程师', '{"v":1,"data":[]}', $1)`,
        [AT],
      ),
    ).resolves.toBeDefined()
  })
})
