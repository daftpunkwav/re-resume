/**
 * @file SelectedBlockPanel
 * @description Actions for the one selected block: remove it, or move it
 * between the two layout modes.
 *
 * Constraints:
 * - It decides nothing. Every control reports an intent, and the editor panel
 *   turns it into a DocumentChange, so what happened stays in the revision
 *   chain rather than in this panel's state.
 */

import { Button } from '../../app/components/Button'
import { Panel } from '../../app/components/Panel'
import { isFlowLayout } from '../../../domain/resume/Layout'
import type { Block } from '../../../domain/resume/Block'

const BLOCK_KIND_LABELS: Record<Block['content']['type'], string> = {
  text: '文字区块',
  profile: '资料区块',
  experience: '经历区块',
  divider: '分隔线',
  graphic: '图形',
}

export interface SelectedBlockPanelProps {
  readonly block: Block
  readonly disabled: boolean
  /** A flow block needs laid-out geometry to be pinned where it is drawn. */
  readonly canMakeAbsolute: boolean
  readonly onDelete: () => void
  readonly onMakeAbsolute: () => void
  readonly onMakeFlow: () => void
}

export function SelectedBlockPanel({
  block,
  disabled,
  canMakeAbsolute,
  onDelete,
  onMakeAbsolute,
  onMakeFlow,
}: SelectedBlockPanelProps) {
  return (
    <Panel title="选中区块">
      <p className="resume-selected-kind">{BLOCK_KIND_LABELS[block.content.type]}</p>
      {block.content.type === 'text' ? (
        <p className="resume-selected-hint">双击画布中的这个区块可以直接编辑文字。</p>
      ) : null}
      <div className="resume-selected-actions">
        {isFlowLayout(block.layout) ? (
          <Button onClick={onMakeAbsolute} disabled={disabled || !canMakeAbsolute}>
            转为绝对定位
          </Button>
        ) : (
          <Button onClick={onMakeFlow} disabled={disabled}>
            转为常规流
          </Button>
        )}
        <Button variant="danger" onClick={onDelete} disabled={disabled}>
          删除区块
        </Button>
      </div>
    </Panel>
  )
}
