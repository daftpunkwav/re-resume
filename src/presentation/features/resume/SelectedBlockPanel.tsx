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
  /**
   * A flow block can only be pinned where it is drawn, and only page one
   * draws absolute placement in v1 — a later-page block is offered no pin.
   */
  readonly canMakeAbsolute: boolean
  /**
   * An absolute block raises or lowers by swapping z positions with its
   * neighbour. A neighbour on the same z is not offered: swapping equal
   * positions would change nothing the stable draw order does not already do.
   */
  readonly canRaise: boolean
  readonly canLower: boolean
  readonly onDelete: () => void
  readonly onMakeAbsolute: () => void
  readonly onMakeFlow: () => void
  readonly onRaise: () => void
  readonly onLower: () => void
}

export function SelectedBlockPanel({
  block,
  disabled,
  canMakeAbsolute,
  canRaise,
  canLower,
  onDelete,
  onMakeAbsolute,
  onMakeFlow,
  onRaise,
  onLower,
}: SelectedBlockPanelProps) {
  return (
    <Panel title="选中区块">
      <p className="resume-selected-kind">{BLOCK_KIND_LABELS[block.content.type]}</p>
      {block.content.type === 'text' ? (
        <p className="resume-selected-hint">双击画布中的这个区块可以直接编辑文字。</p>
      ) : null}
      {isFlowLayout(block.layout) && !disabled && !canMakeAbsolute ? (
        <p className="resume-selected-hint">绝对定位目前只支持第一页的区块。</p>
      ) : null}
      <div className="resume-selected-actions">
        {isFlowLayout(block.layout) ? (
          <Button onClick={onMakeAbsolute} disabled={disabled || !canMakeAbsolute}>
            转为绝对定位
          </Button>
        ) : (
          <>
            <Button onClick={onMakeFlow} disabled={disabled}>
              转为常规流
            </Button>
            <div className="resume-selected-layer">
              <Button size="small" onClick={onLower} disabled={disabled || !canLower}>
                下移一层
              </Button>
              <Button size="small" onClick={onRaise} disabled={disabled || !canRaise}>
                上移一层
              </Button>
            </div>
          </>
        )}
        <Button variant="danger" onClick={onDelete} disabled={disabled}>
          删除区块
        </Button>
      </div>
    </Panel>
  )
}
