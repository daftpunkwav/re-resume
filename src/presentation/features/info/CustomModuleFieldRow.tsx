/**
 * @file CustomModuleFieldRow
 * @description One field row of the custom-module authoring form: its label,
 * order buttons, type, length bound and required flag.
 *
 * Responsibilities:
 * - Render one row and report its edits upward
 * - Keep a stored field's type, bound and required flag read-only; only its
 *   label may change, because stored values were validated under that shape
 *
 * Constraints:
 * - The row owns no validation state: the form decides what an error is.
 */

import type { CustomFieldType } from '../../../domain/info/CustomModule'
import { maxLengthForFieldType } from '../../../domain/info/CustomModule'
import { IconButton } from '../../app/components/IconButton'
import type {
  CustomModuleFieldDraft,
  CustomModuleFieldError,
} from './customModuleDraft'

export interface CustomModuleFieldRowProps {
  readonly index: number
  readonly total: number
  readonly field: CustomModuleFieldDraft
  readonly error: CustomModuleFieldError | undefined
  readonly onChange: (patch: Partial<CustomModuleFieldDraft>) => void
  readonly onMove: (direction: -1 | 1) => void
  readonly onRemove: () => void
  /** One field must remain: the last row's removal is disabled. */
  readonly canRemove: boolean
}

export function CustomModuleFieldRow({
  index,
  total,
  field,
  error,
  onChange,
  onMove,
  onRemove,
  canRemove,
}: CustomModuleFieldRowProps) {
  const stored = field.key !== null
  return (
    <li className="info-module-field">
      <div className="info-module-field-row">
        <input
          type="text"
          className="field-control info-module-field-label"
          aria-label={`字段 ${String(index + 1)} 名称`}
          placeholder="字段名称"
          value={field.label}
          aria-invalid={error?.label === undefined ? undefined : true}
          onChange={(event) => onChange({ label: event.target.value })}
        />
        <button
          type="button"
          className="info-order-button"
          aria-label="上移字段"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="info-order-button"
          aria-label="下移字段"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <IconButton
          icon="close"
          label="删除字段"
          size="small"
          disabled={!canRemove}
          onClick={onRemove}
        />
      </div>
      <div className="info-module-field-row info-module-field-config">
        <select
          className="field-control info-module-field-type"
          aria-label={`字段 ${String(index + 1)} 类型`}
          value={field.type}
          disabled={stored}
          onChange={(event) => {
            const type = event.target.value as CustomFieldType
            onChange({ type, maxLength: maxLengthForFieldType(type) })
          }}
        >
          <option value="text">单行文本</option>
          <option value="textarea">多行文本</option>
        </select>
        <label className="info-module-field-length">
          <span>上限</span>
          <input
            type="number"
            className="field-control info-module-field-number"
            aria-label={`字段 ${String(index + 1)} 长度上限`}
            min={1}
            max={maxLengthForFieldType(field.type)}
            value={field.maxLength}
            disabled={stored}
            onChange={(event) => onChange({ maxLength: Number(event.target.value) })}
          />
        </label>
        <label className="info-module-field-required">
          <input
            type="checkbox"
            checked={field.required}
            disabled={stored}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          <span>必填</span>
        </label>
      </div>
      {error === undefined ? null : (
        <p className="field-error">{error.label ?? error.maxLength}</p>
      )}
    </li>
  )
}
