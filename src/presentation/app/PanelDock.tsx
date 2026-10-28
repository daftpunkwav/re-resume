/**
 * @file PanelDock
 * @description The right-hand tool area: one panel, both panels side by side,
 * or — below the wide breakpoint with both open — one panel at a time behind
 * tabs. It owns the drag edge between itself and the conversation.
 *
 * Responsibilities:
 * - Render the open panel or panels and the header that closes them
 * - Split the dock in two when both panels are open on a wide window, with a
 *   draggable divider between the panes
 * - Hide itself when no panel is open; the window allocates no width for it
 *
 * Constraints:
 * - The panel contents belong to the information and resume features; this
 *   file only frames them and routes their close command. The information panel
 *   is here; the resume panel is still its placeholder until its feature lands.
 * - A close is a navigation away from the information panel, so it goes through
 *   the panel's unsaved-draft guard rather than writing the shell state here.
 * - While closed, the contents are unmounted rather than hidden: a region that
 *   cannot be seen must not keep its buttons in the tab order.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import {
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_NARROW_MAX,
} from '../../domain/settings/AppSettings'
import { IconButton } from './components/IconButton'
import { TabList } from './components/Tabs'
import { InfoPanel } from '../features/info/InfoPanel'
import { requestInfoPanelClose } from '../features/info/panelBridge'
import { ResumePanel } from '../features/resume/ResumePanel'
import {
  addEntryToConversation,
  addResumeToConversation,
} from '../features/conversation/contextInjection'
import { ResizeHandle } from './ResizeHandle'
import type { LayoutTier } from './useLayoutTier'
import { canSplitPanels, useViewportWidth } from './useLayoutTier'
import { useShellStore } from './stores/shellStore'

export interface PanelDockProps {
  readonly tier: LayoutTier
}

type PanelKind = 'resume' | 'info'

const PANEL_TABS = [
  { id: 'resume', label: '简历创作' },
  { id: 'info', label: '简历信息' },
] as const satisfies readonly { readonly id: PanelKind; readonly label: string }[]

const PANEL_TITLES: Readonly<Record<PanelKind, string>> = {
  resume: '简历创作',
  info: '简历信息',
}

/** Below this width two panes would each fall under their own minimum. */
const TWO_PANE_MIN_WIDTH = PANEL_WIDTH_MIN * 2

function panelBody(kind: PanelKind) {
  return kind === 'resume' ? (
    <ResumePanel onAddResumeToConversation={addResumeToConversation} />
  ) : (
    <InfoPanel onAddEntryToConversation={addEntryToConversation} />
  )
}

/**
 * Both feature panels fill their region and own their own scrolling; the
 * placeholder-centered body layout would leave them floating in the middle of a
 * scroll container.
 */
function dockBodyClass(_kind: PanelKind): string {
  return 'dock-body dock-body-fill'
}

function PaneHeader({ kind, onClose }: { readonly kind: PanelKind; readonly onClose: () => void }) {
  const title = PANEL_TITLES[kind]
  return (
    <header className="dock-head">
      <h2 className="dock-title">{title}</h2>
      <IconButton icon="close" label={`关闭${title}`} size="small" onClick={onClose} />
    </header>
  )
}

/**
 * The divider between the two panes. The split is a view preference of the
 * current window, not a stored setting, so it starts at the middle and lives
 * as long as the window does.
 */
function SplitDivider({
  ratio,
  bounds,
  onChange,
}: {
  readonly ratio: number
  readonly bounds: { readonly minimum: number; readonly maximum: number }
  readonly onChange: (ratio: number) => void
}) {
  const drag = useRef<{ readonly pointerId: number; readonly rect: DOMRect } | null>(null)

  const ratioAt = (clientX: number, rect: DOMRect): number => {
    const raw = rect.width === 0 ? 0.5 : (clientX - rect.left) / rect.width
    return Math.min(bounds.maximum, Math.max(bounds.minimum, raw))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const split = event.currentTarget.closest<HTMLElement>('.panel-split')
    if (split === null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, rect: split.getBoundingClientRect() }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (state === null || state.pointerId !== event.pointerId) return
    onChange(ratioAt(event.clientX, state.rect))
  }

  const onPointerUp = (): void => {
    drag.current = null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.08 : 0.02
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onChange(Math.max(bounds.minimum, ratio - step))
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onChange(Math.min(bounds.maximum, ratio + step))
    }
  }

  return (
    <div
      className="panel-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整面板分栏"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(bounds.minimum * 100)}
      aria-valuemax={Math.round(bounds.maximum * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}

export function PanelDock({ tier }: PanelDockProps) {
  const rightPanel = useShellStore((state) => state.rightPanel)
  const rightWidth = useShellStore((state) => state.rightWidth)
  const setRightWidth = useShellStore((state) => state.setRightWidth)
  const setRightPanel = useShellStore((state) => state.setRightPanel)
  const togglePanel = useShellStore((state) => state.togglePanel)
  const viewportWidth = useViewportWidth()

  const [activeTab, setActiveTab] = useState<PanelKind>('resume')
  const [splitRatio, setSplitRatio] = useState(0.5)
  const dockRef = useRef<HTMLElement>(null)

  const open = rightPanel !== 'none'

  // Below the compact breakpoint the drawer covers the conversation, so opening
  // it moves the keyboard into it; Escape and the close button then return it.
  useEffect(() => {
    if (tier !== 'compact' || !open) return
    dockRef.current?.focus()
  }, [tier, open])
  const maximum = tier === 'wide' ? PANEL_WIDTH_MAX : PANEL_WIDTH_NARROW_MAX
  const storedWidth = Math.min(rightWidth, maximum)
  const both = rightPanel === 'both'
  // Both panes need enough window beside the conversation; below that the dock
  // keeps one pane at a time behind the tabs and remembers which panel was last
  // in front. The stored width is not rewritten, so closing one panel returns to
  // the width the user chose.
  const splitView = both && tier === 'wide' && canSplitPanels(viewportWidth)
  const dockWidth = splitView ? Math.max(storedWidth, TWO_PANE_MIN_WIDTH) : storedWidth
  const minimumRatio = dockWidth === 0 ? 0.5 : Math.min(0.5, PANEL_WIDTH_MIN / dockWidth)
  const bounds = { minimum: minimumRatio, maximum: 1 - minimumRatio }
  const resizeMinimum = splitView ? TWO_PANE_MIN_WIDTH : PANEL_WIDTH_MIN

  // In the tabs fallback, opening the second panel brings the newly opened one
  // to the front; without this the tab would stay on whichever pane happened to
  // be in front before the other entry was used.
  const previousPanel = useRef(rightPanel)
  useEffect(() => {
    const previous = previousPanel.current
    previousPanel.current = rightPanel
    if (splitView || rightPanel !== 'both') return
    if (previous === 'resume') setActiveTab('info')
    if (previous === 'info') setActiveTab('resume')
  }, [rightPanel, splitView])

  // A close is a navigation away from the information panel, so it has to pass
  // the panel's unsaved-draft guard first. With the panel not mounted (the
  // resume panel is the only one open) the bridge runs the close immediately.
  const closeAll = (): void => requestInfoPanelClose(() => setRightPanel('none'))
  const closeInfoPane = (): void => requestInfoPanelClose(() => togglePanel('info'))

  return (
    <aside
      ref={dockRef}
      id="panel-dock"
      className="panel-dock"
      data-open={open}
      aria-label="右侧面板"
      // Nothing focusable is rendered while the dock is closed, so hiding it
      // from assistive technology cannot strand the tab order in it.
      aria-hidden={open ? undefined : true}
      data-region={open ? 'panel' : undefined}
      tabIndex={open ? -1 : undefined}
    >
      {open ? (
        <>
          <div className="panel-dock-surface">
            {splitView ? (
              <div className="panel-split">
                <section
                  className="dock-pane"
                  style={{ flexBasis: `${Math.round(splitRatio * 100)}%` }}
                  aria-label="简历创作"
                >
                  <PaneHeader kind="resume" onClose={() => togglePanel('resume')} />
                  <div className={dockBodyClass('resume')}>{panelBody('resume')}</div>
                </section>
                <SplitDivider ratio={splitRatio} bounds={bounds} onChange={setSplitRatio} />
                <section className="dock-pane" aria-label="简历信息">
                  <PaneHeader kind="info" onClose={closeInfoPane} />
                  <div className={dockBodyClass('info')}>{panelBody('info')}</div>
                </section>
              </div>
            ) : (
              <>
                <header className="dock-head">
                  {both ? (
                    <TabList
                      tabs={PANEL_TABS}
                      active={activeTab}
                      onChange={setActiveTab}
                      label="面板切换"
                      className="tabs-list-dock"
                    />
                  ) : (
                    <h2 className="dock-title">
                      {PANEL_TITLES[rightPanel === 'resume' ? 'resume' : 'info']}
                    </h2>
                  )}
                  <IconButton icon="close" label="关闭面板" size="small" onClick={closeAll} />
                </header>
                <div
                  className={dockBodyClass(
                    both ? activeTab : rightPanel === 'resume' ? 'resume' : 'info',
                  )}
                  // The tab list names the panel it controls; the single-panel
                  // header has no tab list and therefore no tabpanel role.
                  {...(both
                    ? {
                        role: 'tabpanel' as const,
                        id: `tabpanel-${activeTab}`,
                        'aria-labelledby': `tab-${activeTab}`,
                      }
                    : {})}
                >
                  {panelBody(both ? activeTab : rightPanel === 'resume' ? 'resume' : 'info')}
                </div>
              </>
            )}
          </div>
          {tier === 'compact' ? null : (
            <ResizeHandle
              width={dockWidth}
              minimum={resizeMinimum}
              maximum={maximum}
              onCommit={(width) => setRightWidth(width, maximum)}
            />
          )}
        </>
      ) : null}
    </aside>
  )
}
