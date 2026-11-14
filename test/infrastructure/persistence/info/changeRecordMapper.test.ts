/**
 * @file changeRecordMapper.test
 * @description Row-to-domain mapping of the append-only change log: a row the
 * mapper cannot interpret is reported, never coerced. The entity column is a
 * closed union now, so a row naming another family is refused the same way an
 * unknown scope, op or origin is.
 */

import { describe, expect, it } from 'vitest'

import { RowMappingError } from '../../../../src/infrastructure/persistence/JsonEnvelope'
import { mapChangeRecordRow } from '../../../../src/infrastructure/persistence/info/mappers/ChangeRecordRowMapper'

const AT = '2026-01-01T00:00:00.000Z'

function changeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'change-1',
    scope: 'library',
    entity: 'infoEntry',
    entity_id: 'entry-1',
    op: 'infoEntry.update',
    before_json: null,
    after_json: null,
    origin: 'user',
    run_id: null,
    conversation_id: null,
    label: 'Update the entry',
    undone_at: null,
    created_at: AT,
    ...overrides,
  }
}

describe('change record row mapper', () => {
  it('maps a row of every declared entity family', () => {
    for (const entity of ['infoEntry', 'customModule', 'jobPosting'] as const) {
      expect(mapChangeRecordRow(changeRow({ entity }))).toMatchObject({
        id: 'change-1',
        scope: 'library',
        entity,
        entityId: 'entry-1',
        op: 'infoEntry.update',
      })
    }
  })

  it('refuses an entity family this build does not know', () => {
    // The column has no check constraint in the schema, so an older or
    // external writer can store any text; the mapper is the read-side gate.
    expect(() => mapChangeRecordRow(changeRow({ entity: 'resume' }))).toThrow(RowMappingError)
    expect(() => mapChangeRecordRow(changeRow({ entity: '' }))).toThrow(RowMappingError)
  })
})
