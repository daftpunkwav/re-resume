/**
 * @file ModuleNav
 * @description The module column of the information panel: the eight built-in
 * modules, the user-defined ones and the entry to create another. On a narrow
 * panel the same list collapses into a dropdown (`ModulePicker`), which is the
 * reason both read the same summary shape.
 *
 * Responsibilities:
 * - Render one selectable row per module with its entry count
 * - Offer the create-module entry, disabled at the library's module limit
 * - Fold into a picker at widths where a column would leave the editor too
 *   narrow
 *
 * Constraints:
 * - The labels and counts come from `listInfoEntries`; no module is named here.
 */

import { Button } from '../../app/components/Button'
import { IconButton } from '../../app/components/IconButton'
import { SelectField } from '../../app/components/SelectField'
import type { InfoModuleSummary } from '../../../application/info/listInfoEntries'
import { CUSTOM_MODULE_LIMIT } from '../../../domain/info/CustomModule'
import type { CustomModuleId } from '../../../domain/shared/branded-id'
import type { ModuleSelection } from './stores/infoStore'

/** A stable key for one module row; custom ids are opaque but unique. */
function moduleSelectionKey(
  moduleKind: ModuleSelection['moduleKind'],
  customModuleId: CustomModuleId | null,
): string {
  return customModuleId === null ? moduleKind : `${moduleKind}:${customModuleId}`
}

function selectionForSummary(summary: InfoModuleSummary): ModuleSelection {
  return { moduleKind: summary.moduleKind, customModuleId: summary.customModuleId }
}

function isSelected(
  selection: ModuleSelection | null,
  summary: InfoModuleSummary,
): boolean {
  if (selection === null) return false
  return moduleSelectionKey(selection.moduleKind, selection.customModuleId) ===
    moduleSelectionKey(summary.moduleKind, summary.customModuleId)
}

interface ModuleLimit {
  /** True when the library already holds the contract's maximum. */
  readonly reached: boolean
}

export interface ModuleNavProps {
  readonly summaries: readonly InfoModuleSummary[]
  readonly selectedModule: ModuleSelection | null
  readonly onSelect: (selection: ModuleSelection) => void
  readonly onCreateModule: () => void
}

function moduleLimit(summaries: readonly InfoModuleSummary[]): ModuleLimit {
  const customCount = summaries.filter((summary) => summary.moduleKind === 'custom').length
  return { reached: customCount >= CUSTOM_MODULE_LIMIT }
}

interface ModuleRowProps {
  readonly summary: InfoModuleSummary
  readonly selected: boolean
  readonly onSelect: () => void
}

function ModuleRow({ summary, selected, onSelect }: ModuleRowProps) {
  return (
    <li>
      <button
        type="button"
        className={selected ? 'info-nav-item info-nav-item-active' : 'info-nav-item'}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className="info-nav-label">{summary.label}</span>
        <span
          className={summary.entryCount === 0 ? 'info-nav-count info-nav-count-zero' : 'info-nav-count'}
        >
          {summary.entryCount}
        </span>
      </button>
    </li>
  )
}

export function ModuleNav({
  summaries,
  selectedModule,
  onSelect,
  onCreateModule,
}: ModuleNavProps) {
  const builtIn = summaries.filter((summary) => summary.moduleKind !== 'custom')
  const custom = summaries.filter((summary) => summary.moduleKind === 'custom')
  const limit = moduleLimit(summaries)

  return (
    <nav className="info-nav" aria-label="信息模块">
      <p className="info-nav-head">模块</p>
      <div className="info-nav-scroll">
        <ul className="info-nav-list">
          {builtIn.map((summary) => (
            <ModuleRow
              key={moduleSelectionKey(summary.moduleKind, summary.customModuleId)}
              summary={summary}
              selected={isSelected(selectedModule, summary)}
              onSelect={() => onSelect(selectionForSummary(summary))}
            />
          ))}
        </ul>
        {custom.length === 0 ? null : (
          <>
            <p className="info-nav-section">自定义</p>
            <ul className="info-nav-list">
              {custom.map((summary) => (
                <ModuleRow
                  key={moduleSelectionKey(summary.moduleKind, summary.customModuleId)}
                  summary={summary}
                  selected={isSelected(selectedModule, summary)}
                  onSelect={() => onSelect(selectionForSummary(summary))}
                />
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="info-nav-foot">
        <Button
          variant="ghost"
          size="small"
          icon="plus"
          block
          disabled={limit.reached}
          onClick={onCreateModule}
        >
          新建模块
        </Button>
        {limit.reached ? (
          <p className="info-nav-limit">最多 {CUSTOM_MODULE_LIMIT} 个自定义模块</p>
        ) : null}
      </div>
    </nav>
  )
}

export interface ModulePickerProps {
  readonly summaries: readonly InfoModuleSummary[]
  readonly selectedModule: ModuleSelection | null
  readonly onSelect: (selection: ModuleSelection) => void
  readonly onCreateModule: () => void
}

/** The collapsed navigation used when the panel is too narrow for a column. */
export function ModulePicker({
  summaries,
  selectedModule,
  onSelect,
  onCreateModule,
}: ModulePickerProps) {
  const limit = moduleLimit(summaries)
  const options = summaries.map((summary) => ({
    value: moduleSelectionKey(summary.moduleKind, summary.customModuleId),
    label: `${summary.label}（${summary.entryCount}）`,
  }))
  const selectedValue =
    selectedModule === null
      ? ''
      : moduleSelectionKey(selectedModule.moduleKind, selectedModule.customModuleId)
  const selectedSummary = summaries.find(
    (summary) =>
      moduleSelectionKey(summary.moduleKind, summary.customModuleId) === selectedValue,
  )

  return (
    <div className="info-module-picker">
      <SelectField
        label="模块"
        value={selectedSummary === undefined ? '' : selectedValue}
        options={options}
        onChange={(event) => {
          const next = summaries.find(
            (summary) =>
              moduleSelectionKey(summary.moduleKind, summary.customModuleId) ===
              event.target.value,
          )
          if (next !== undefined) onSelect(selectionForSummary(next))
        }}
      />
      <IconButton
        icon="plus"
        label={limit.reached ? `已达 ${String(CUSTOM_MODULE_LIMIT)} 个自定义模块上限` : '新建模块'}
        variant="secondary"
        size="medium"
        disabled={limit.reached}
        onClick={onCreateModule}
      />
    </div>
  )
}
