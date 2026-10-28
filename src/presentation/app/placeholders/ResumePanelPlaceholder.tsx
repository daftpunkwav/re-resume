/**
 * @file ResumePanelPlaceholder
 * @description The empty state of the right-hand resume panel.
 *
 * The resume studio (PR-08) replaces this file with the resume list, canvas
 * viewport and composition editor. Until then the panel explains what it will
 * show rather than rendering a canvas with nothing behind it.
 */

import { EmptyState } from '../components/EmptyState'

export function ResumePanelPlaceholder() {
  return (
    <EmptyState
      compact
      icon="pen"
      title="还没有简历"
      description="「简历创作」把选中的信息条目组合成一份简历，并调整模板、页面与排版。"
    />
  )
}
