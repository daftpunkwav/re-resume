/**
 * @file BackupDocument
 * @description The versioned JSON document a user exports and imports: every
 * row of every table, plus the attachment bytes beside the rows that name them.
 *
 * Responsibilities:
 * - Declare the document v1 shape and the table set this schema version writes
 * - Validate a document before anything is written: structure, row columns,
 *   column types, JSON payloads and the attachment/row correspondence
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package. It never imports a
 *   persistence mapper, so the row contract is stated here a second time on
 *   purpose: a mapper change must make a backup written by the previous build
 *   fail validation rather than be silently coerced.
 * - Validation is total and happens before the first write. A document that
 *   fails one row is rejected as a whole (spec section 8.7).
 * - Cross-row invariants (primary keys, foreign keys, unique indexes) are left
 *   to the database transaction that applies the document; they cannot be
 *   checked meaningfully one row at a time.
 */

import { isAppSettings } from '../settings/AppSettings'
import type { DateTime } from '../shared/DateTime'
import { parseDateTime } from '../shared/DateTime'
import { DomainError } from '../shared/DomainError'
import { isInfoModuleKind } from '../info/InfoModuleKind'

/** The document version this build writes and the only one it accepts. */
export const BACKUP_DOCUMENT_VERSION = 1

/**
 * The schema version the document was written against. Every migration is
 * applied in order, so this equals the number of registered migration files;
 * a document from another schema is refused rather than mapped optimistically.
 */
export const BACKUP_SCHEMA_VERSION = 10

/** The application marker that rejects a JSON file that is not ours. */
export const BACKUP_APP_MARKER = 're-resume' as const

/** One raw table row: columns are text, integer or null, exactly as SQLite stores them. */
export type BackupRow = Readonly<Record<string, string | number | null>>

/** Rows per table, keyed by the table name. */
export type BackupTables = Readonly<Record<string, readonly BackupRow[]>>

/** An attachment row and the bytes its storage name refers to. */
export interface BackupAttachment {
  readonly row: BackupRow
  readonly bytesBase64: string
}

/** The whole exported file. */
export interface BackupDocument {
  readonly v: typeof BACKUP_DOCUMENT_VERSION
  readonly app: typeof BACKUP_APP_MARKER
  readonly exportedAt: DateTime
  readonly schemaVersion: typeof BACKUP_SCHEMA_VERSION
  readonly tables: BackupTables
  readonly attachments: readonly BackupAttachment[]
}

type ColumnKind = 'text' | 'int' | 'nullableInt' | 'json' | 'nullableJson' | 'timestamp' | 'nullableTimestamp'

interface TableSchema {
  readonly columns: Readonly<Record<string, ColumnKind>>
  /** Extra row check beyond the column kinds; returns a problem or null. */
  readonly checkRow?: (row: BackupRow) => string | null
}

const ENUM_KIND = (row: BackupRow, column: string, allowed: readonly string[]): string | null => {
  const value = row[column]
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return `column ${column} must be one of ${allowed.join('|')}`
  }
  return null
}

const FLAG = (row: BackupRow, column: string): string | null => {
  const value = row[column]
  return value === 0 || value === 1 ? null : `column ${column} must be 0 or 1`
}

const JSON_OBJECT = (row: BackupRow, column: string): string | null => {
  if (JSON.parse(String(row[column])) === null) return null
  const parsed: unknown = JSON.parse(String(row[column]))
  return typeof parsed === 'object' ? null : `column ${column} must hold a JSON object or array`
}

const TIMESTAMP = (row: BackupRow, column: string): string | null => {
  return parseDateTime(String(row[column])) === null
    ? `column ${column} must be an ISO timestamp`
    : null
}

const PROVIDER_KINDS = ['openai-compatible', 'anthropic'] as const
const ORIGINS = ['user', 'agent'] as const
const CHANGE_SCOPES = ['library', 'jobPosting'] as const
const MESSAGE_KINDS = ['user', 'assistant', 'tool'] as const
const MESSAGE_STATUSES = ['streaming', 'complete', 'cancelled', 'failed', 'running'] as const
const ATTACHMENT_KINDS = ['image', 'file'] as const
const RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const
const TOOL_RISKS = ['read', 'write', 'draft'] as const
const TOOL_STATUSES = ['ok', 'failed'] as const
const RESUME_STATUSES = ['draft', 'frozen'] as const
const CONTEXT_KINDS = ['entry', 'resume', 'jobPosting'] as const

/**
 * The table set and the row columns of `BACKUP_SCHEMA_VERSION`. Insert order is
 * the order below; a restore deletes in reverse so every foreign key is
 * satisfied on both sides.
 */
export const BACKUP_TABLES: readonly string[] = [
  'app_settings',
  'provider_config',
  'custom_module',
  'info_entry',
  'change_record',
  'conversation',
  'attachment',
  'message',
  'message_attachment',
  'message_context',
  'job_posting',
  'agent_run',
  'tool_invocation',
  'resume',
  'resume_revision',
  'resume_snapshot',
]

const TABLE_SCHEMAS: Readonly<Record<string, TableSchema>> = {
  app_settings: {
    columns: {
      id: 'text',
      settings_json: 'json',
      updated_at: 'timestamp',
    },
    checkRow(row) {
      if (row.id !== 'default') return "column id must be 'default'"
      let parsed: unknown
      try {
        parsed = JSON.parse(String(row.settings_json))
      } catch {
        return 'column settings_json is not JSON'
      }
      return isAppSettings(parsed) ? null : 'column settings_json is not a settings value of this build'
    },
  },
  provider_config: {
    columns: {
      id: 'text',
      name: 'text',
      kind: 'text',
      base_url: 'text',
      model_id: 'text',
      secret_ref: 'text',
      supports_images: 'nullableInt',
      is_active: 'int',
      created_at: 'timestamp',
      updated_at: 'timestamp',
    },
    checkRow(row) {
      return (
        ENUM_KIND(row, 'kind', PROVIDER_KINDS) ??
        FLAG(row, 'is_active') ??
        (row.supports_images === null || row.supports_images === 0 || row.supports_images === 1
          ? null
          : 'column supports_images must be 0, 1 or null')
      )
    },
  },
  custom_module: {
    columns: {
      id: 'text',
      name: 'text',
      fields_json: 'json',
      sort_order: 'int',
      created_at: 'timestamp',
      updated_at: 'timestamp',
    },
    checkRow(row) {
      if (typeof row.sort_order !== 'number' || row.sort_order < 1) {
        return 'column sort_order must be a positive integer'
      }
      try {
        const parsed: unknown = JSON.parse(String(row.fields_json))
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return 'column fields_json must hold a non-empty array'
        }
      } catch {
        return 'column fields_json is not JSON'
      }
      return null
    },
  },
  info_entry: {
    columns: {
      id: 'text',
      module_kind: 'text',
      custom_module_id: 'nullableInt',
      title: 'text',
      fields_json: 'json',
      sort_order: 'int',
      origin: 'text',
      source_run_id: 'nullableInt',
      created_at: 'timestamp',
      updated_at: 'timestamp',
    },
    checkRow(row) {
      return (
        (isInfoModuleKind(row.module_kind) ? null : 'column module_kind is not a module kind') ??
        ENUM_KIND(row, 'origin', ORIGINS) ??
        (typeof row.sort_order === 'number' && row.sort_order >= 1
          ? null
          : 'column sort_order must be a positive integer') ??
        ((row.module_kind === 'custom') === (row.custom_module_id !== null)
          ? null
          : 'custom_module_id must be set exactly for the custom module kind') ??
        JSON_OBJECT(row, 'fields_json')
      )
    },
  },
  change_record: {
    columns: {
      id: 'text',
      scope: 'text',
      entity: 'text',
      entity_id: 'text',
      op: 'text',
      before_json: 'nullableJson',
      after_json: 'nullableJson',
      origin: 'text',
      run_id: 'nullableInt',
      conversation_id: 'nullableInt',
      label: 'text',
      undone_at: 'nullableTimestamp',
      created_at: 'timestamp',
    },
    checkRow(row) {
      const scope = ENUM_KIND(row, 'scope', CHANGE_SCOPES)
      if (scope !== null) return scope
      const origin = ENUM_KIND(row, 'origin', ORIGINS)
      if (origin !== null) return origin
      if (row.undone_at !== null) return TIMESTAMP(row, 'undone_at')
      return null
    },
  },
  conversation: {
    columns: {
      id: 'text',
      title: 'text',
      provider_id: 'nullableInt',
      model_id: 'nullableInt',
      pinned: 'int',
      active_resume_id: 'nullableInt',
      summary: 'nullableInt',
      summary_through_seq: 'nullableInt',
      created_at: 'timestamp',
      updated_at: 'timestamp',
    },
    checkRow(row) {
      return (
        FLAG(row, 'pinned') ??
        (row.summary_through_seq === null || typeof row.summary_through_seq === 'number'
          ? null
          : 'column summary_through_seq must be an integer or null')
      )
    },
  },
  attachment: {
    columns: {
      id: 'text',
      kind: 'text',
      mime_type: 'text',
      byte_size: 'int',
      storage_name: 'text',
      width: 'nullableInt',
      height: 'nullableInt',
      sha256: 'text',
      created_at: 'timestamp',
    },
    checkRow(row) {
      const storageName = row.storage_name
      if (
        typeof storageName === 'string' &&
        (storageName === '' || /[\\/]/u.test(storageName) || storageName.includes('..') || /^[A-Za-z]:/u.test(storageName))
      ) {
        return 'column storage_name must be a plain file name'
      }
      return (
        ENUM_KIND(row, 'kind', ATTACHMENT_KINDS) ??
        (typeof row.byte_size === 'number' && row.byte_size > 0
          ? null
          : 'column byte_size must be a positive integer') ??
        (typeof row.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(row.sha256)
          ? null
          : 'column sha256 must be 64 lowercase hex characters')
      )
    },
  },
  message: {
    columns: {
      id: 'text',
      conversation_id: 'text',
      seq: 'int',
      kind: 'text',
      status: 'text',
      markdown: 'text',
      tool_json: 'nullableJson',
      run_id: 'nullableInt',
      error_text: 'nullableInt',
      created_at: 'timestamp',
      updated_at: 'timestamp',
    },
    checkRow(row) {
      const kind = ENUM_KIND(row, 'kind', MESSAGE_KINDS)
      if (kind !== null) return kind
      const status = ENUM_KIND(row, 'status', MESSAGE_STATUSES)
      if (status !== null) return status
      if (typeof row.seq !== 'number' || row.seq < 1) return 'column seq must be a positive integer'
      const hasTool = row.tool_json !== null
      return (row.kind === 'tool') === hasTool
        ? null
        : 'a tool message carries tool_json and no other message does'
    },
  },
  message_attachment: {
    columns: {
      message_id: 'text',
      attachment_id: 'text',
      position: 'int',
    },
    checkRow(row) {
      return typeof row.position === 'number' && row.position >= 0
        ? null
        : 'column position must be a non-negative integer'
    },
  },
  message_context: {
    columns: {
      message_id: 'text',
      kind: 'text',
      ref_id: 'text',
      position: 'int',
    },
    checkRow(row) {
      return (
        ENUM_KIND(row, 'kind', CONTEXT_KINDS) ??
        (typeof row.position === 'number' && row.position >= 0
          ? null
          : 'column position must be a non-negative integer')
      )
    },
  },
  job_posting: {
    columns: {
      id: 'text',
      raw_text: 'text',
      source: 'nullableInt',
      image_attachment_ids: 'json',
      conversation_id: 'nullableInt',
      resume_id: 'nullableInt',
      parsed_json: 'nullableJson',
      parsed_by_run_id: 'nullableInt',
      parsed_at: 'nullableTimestamp',
      created_at: 'timestamp',
    },
    checkRow(row) {
      if (row.raw_text === '' && row.image_attachment_ids === '{"v":1,"data":[]}') {
        return 'a posting needs raw text or image attachments'
      }
      if (row.parsed_at !== null) return TIMESTAMP(row, 'parsed_at')
      return null
    },
  },
  agent_run: {
    columns: {
      id: 'text',
      conversation_id: 'nullableInt',
      resume_id: 'nullableInt',
      job_posting_id: 'nullableInt',
      status: 'text',
      error_text: 'nullableInt',
      prompt_tokens: 'nullableInt',
      completion_tokens: 'nullableInt',
      started_at: 'timestamp',
      ended_at: 'nullableTimestamp',
    },
    checkRow(row) {
      const status = ENUM_KIND(row, 'status', RUN_STATUSES)
      if (status !== null) return status
      return row.ended_at === null ? null : TIMESTAMP(row, 'ended_at')
    },
  },
  tool_invocation: {
    columns: {
      id: 'text',
      run_id: 'text',
      message_id: 'nullableInt',
      tool_name: 'text',
      risk: 'text',
      args_json: 'json',
      result_summary_json: 'nullableJson',
      change_ids_json: 'json',
      revision_id: 'nullableInt',
      status: 'text',
      created_at: 'timestamp',
    },
    checkRow(row) {
      return (
        ENUM_KIND(row, 'risk', TOOL_RISKS) ?? ENUM_KIND(row, 'status', TOOL_STATUSES)
      )
    },
  },
  resume: {
    columns: {
      id: 'text',
      title: 'text',
      target_job_json: 'nullableJson',
      status: 'text',
      current_revision_id: 'text',
      conversation_id: 'nullableInt',
      created_at: 'timestamp',
      updated_at: 'timestamp',
    },
    checkRow(row) {
      return ENUM_KIND(row, 'status', RESUME_STATUSES)
    },
  },
  resume_revision: {
    columns: {
      id: 'text',
      resume_id: 'text',
      seq: 'int',
      label: 'text',
      origin: 'text',
      run_id: 'nullableInt',
      state_json: 'json',
      superseded_at: 'nullableTimestamp',
      created_at: 'timestamp',
    },
    checkRow(row) {
      const origin = ENUM_KIND(row, 'origin', ORIGINS)
      if (origin !== null) return origin
      if (typeof row.seq !== 'number' || row.seq < 1) return 'column seq must be a positive integer'
      if (row.superseded_at !== null) return TIMESTAMP(row, 'superseded_at')
      const shape = JSON_OBJECT(row, 'state_json')
      if (shape !== null) return shape
      return null
    },
  },
  resume_snapshot: {
    columns: {
      id: 'text',
      resume_id: 'text',
      seq: 'int',
      frozen_state_json: 'json',
      materialized_json: 'json',
      created_at: 'timestamp',
    },
    checkRow(row) {
      return typeof row.seq === 'number' && row.seq >= 1
        ? null
        : 'column seq must be a positive integer'
    },
  },
}

/** Decoded size of a base64 string, without allocating the bytes. */
function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function reject(path: string, reason: string): DomainError {
  return new DomainError('invalidSettings', `备份文件无效（${path}）：${reason}`, {
    entity: 'backupDocument',
    id: path,
    blockers: [path],
  })
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateColumn(row: BackupRow, column: string, kind: ColumnKind): string | null {
  const value = row[column]
  switch (kind) {
    case 'text':
      return typeof value === 'string' ? null : `column ${column} must be text`
    case 'int':
      return typeof value === 'number' && Number.isInteger(value)
        ? null
        : `column ${column} must be an integer`
    case 'nullableInt':
      return value === null || (typeof value === 'number' && Number.isInteger(value))
        ? null
        : `column ${column} must be an integer or null`
    case 'json':
      try {
        JSON.parse(String(value))
        return null
      } catch {
        return `column ${column} must be JSON`
      }
    case 'nullableJson':
      if (value === null) return null
      try {
        JSON.parse(String(value))
        return null
      } catch {
        return `column ${column} must be JSON or null`
      }
    case 'timestamp':
      return TIMESTAMP(row, column)
    case 'nullableTimestamp':
      return value === null ? null : TIMESTAMP(row, column)
  }
}

function validateRow(table: string, index: number, value: unknown): BackupRow {
  const schema = TABLE_SCHEMAS[table]
  if (schema === undefined) throw reject(`${table}[${index.toString()}]`, 'the table is not part of this schema')
  if (!isRecord(value)) throw reject(`${table}[${index.toString()}]`, 'the row is not an object')
  const row: Record<string, string | number | null> = {}
  for (const column of Object.keys(schema.columns)) {
    if (!(column in value)) {
      throw reject(`${table}[${index.toString()}].${column}`, 'the column is missing')
    }
    const cell = value[column]
    if (cell !== null && typeof cell !== 'string' && typeof cell !== 'number') {
      throw reject(`${table}[${index.toString()}].${column}`, 'the cell is not a scalar value')
    }
    row[column] = cell
  }
  const extra = Object.keys(value).filter((key) => !(key in schema.columns))
  if (extra.length > 0) {
    throw reject(`${table}[${index.toString()}].${extra[0] as string}`, 'the column is not part of this schema')
  }
  const typedRow: BackupRow = row
  for (const [column, kind] of Object.entries(schema.columns)) {
    const problem = validateColumn(typedRow, column, kind)
    if (problem !== null) throw reject(`${table}[${index.toString()}]`, problem)
  }
  const extraProblem = schema.checkRow?.(typedRow) ?? null
  if (extraProblem !== null) throw reject(`${table}[${index.toString()}]`, extraProblem)
  return typedRow
}

/** Checks the table map and returns it unchanged. */
export function validateBackupTables(tables: BackupTables): BackupTables {
  for (const table of BACKUP_TABLES) {
    if (!(table in tables)) throw reject(table, 'the table is missing from the document')
    const rows = tables[table]
    if (!Array.isArray(rows)) throw reject(table, 'the table is not an array of rows')
    rows.forEach((row, index) => {
      validateRow(table, index, row)
    })
  }
  const extraTables = Object.keys(tables).filter((table) => !BACKUP_TABLES.includes(table))
  if (extraTables.length > 0) throw reject(extraTables[0] as string, 'the table is not part of this schema')
  const settings = tables.app_settings ?? []
  if (settings.length > 1) throw reject('app_settings', 'the table holds one settings row')
  return tables
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

/** Reads an unknown JSON value into a backup document of this version, or refuses it. */
export function parseBackupDocument(raw: unknown): BackupDocument {
  if (!isRecord(raw)) throw reject('document', 'the file does not hold a JSON object')
  if (raw.v !== BACKUP_DOCUMENT_VERSION) {
    throw reject('v', `this build imports document version ${BACKUP_DOCUMENT_VERSION.toString()}`)
  }
  if (raw.app !== BACKUP_APP_MARKER) {
    throw reject('app', 'the file was not exported by ReResume')
  }
  if (raw.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw reject(
      'schemaVersion',
      `this build reads schema version ${BACKUP_SCHEMA_VERSION.toString()}`,
    )
  }
  if (typeof raw.exportedAt !== 'string') throw reject('exportedAt', 'the field must be a timestamp')
  const exportedAt = parseDateTime(raw.exportedAt)
  if (exportedAt === null) throw reject('exportedAt', 'the field must be an ISO timestamp')
  if (!isRecord(raw.tables)) throw reject('tables', 'the field must be an object of tables')
  const tables = validateBackupTables(raw.tables as BackupTables)
  if (!Array.isArray(raw.attachments)) throw reject('attachments', 'the field must be an array')
  const attachments: BackupAttachment[] = []
  for (const [index, entry] of raw.attachments.entries()) {
    if (!isRecord(entry)) throw reject(`attachments[${index.toString()}]`, 'the entry is not an object')
    const row = validateRow('attachment', index, entry.row)
    if (typeof entry.bytesBase64 !== 'string' || !BASE64_PATTERN.test(entry.bytesBase64)) {
      throw reject(`attachments[${index.toString()}].bytesBase64`, 'the bytes are not valid base64')
    }
    const declaredSize = row.byte_size
    if (typeof declaredSize === 'number' && base64ByteLength(entry.bytesBase64) !== declaredSize) {
      throw reject(
        `attachments[${index.toString()}].bytesBase64`,
        'the payload size does not match the byte_size column',
      )
    }
    attachments.push({ row, bytesBase64: entry.bytesBase64 })
  }
  // One row in the attachment table, one byte payload, keyed by storage name.
  const attachmentRows = tables.attachment ?? []
  const names = new Set(attachmentRows.map((row) => row.storage_name))
  const payloadNames = new Set(attachments.map((entry) => entry.row.storage_name))
  if (names.size !== payloadNames.size) {
    throw reject('attachments', 'every attachment row must carry its bytes and vice versa')
  }
  for (const name of names) {
    if (!payloadNames.has(name)) {
      throw reject('attachments', `the bytes of "${String(name)}" are missing`)
    }
  }
  return {
    v: BACKUP_DOCUMENT_VERSION,
    app: BACKUP_APP_MARKER,
    exportedAt,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    tables,
    attachments,
  }
}

/** The result of applying one document. */
export interface BackupImportSummary {
  readonly tables: Readonly<Record<string, number>>
  readonly attachments: number
}

/** Counts the rows and attachments of a document for the confirmation text. */
export function summarizeBackupDocument(document: BackupDocument): BackupImportSummary {
  const tables: Record<string, number> = {}
  for (const table of BACKUP_TABLES) tables[table] = (document.tables[table] ?? []).length
  return { tables, attachments: document.attachments.length }
}
