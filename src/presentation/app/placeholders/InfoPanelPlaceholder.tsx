/**
 * @file InfoPanelPlaceholder
 * @description The empty state of the right-hand information panel.
 *
 * The information feature (PR-06) replaces this file with the module
 * navigation, entry list and editor. Until then the panel explains what it
 * holds instead of showing a form that cannot save.
 */

import { EmptyState } from '../components/EmptyState'

export function InfoPanelPlaceholder() {
  return (
    <EmptyState
      compact
      icon="id-card"
      title="还没有简历信息"
      description="「简历信息」保存个人信息、教育与经历，是一份简历挑选内容的来源。"
    />
  )
}
