/**
 * @file panelBridge
 * @description The two commands the workbench sends into the mounted
 * information panel: focus the search field, and close the dock while an
 * unsaved draft still exists.
 *
 * Responsibilities:
 * - Deliver a search-focus request even when the field does not exist yet
 *   (the shortcut may be what mounts the panel, and the panel then still has
 *   to finish its first read before the search field renders)
 * - Route a close request through the panel's unsaved-draft guard
 * - Hold nothing once the panel unmounts
 *
 * Constraints:
 * - This is the whole shell-to-feature surface: the shell never reaches into
 *   the panel's store or components, and the panel never closes the dock
 *   itself.
 * - A focus request is only cleared when a mounted panel reports that it moved
 *   the keyboard; a request that arrived while the panel was loading survives
 *   until the field can take the focus.
 */

export interface InfoPanelBridgeHandlers {
  /** Moves the keyboard into the search field; false when the field is not mounted yet. */
  readonly focusSearch: () => boolean
  /** Runs `close` once the panel has settled any unsaved draft. */
  readonly requestClose: (close: () => void) => void
}

let handlers: InfoPanelBridgeHandlers | null = null
let pendingSearchFocus = false

/**
 * Binds the live panel. The returned function unbinds only if this binding is
 * still the current one, so a second panel mounted during a transition cannot
 * have its binding cleared by the first one's cleanup.
 *
 * @returns the cleanup that removes this binding
 */
export function bindInfoPanel(next: InfoPanelBridgeHandlers): () => void {
  handlers = next
  if (pendingSearchFocus && next.focusSearch()) pendingSearchFocus = false
  return () => {
    if (handlers === next) handlers = null
  }
}

/** Asks the mounted panel to focus its search field; otherwise remembers the intent. */
export function requestInfoSearchFocus(): void {
  if (handlers !== null && handlers.focusSearch()) return
  pendingSearchFocus = true
}

/**
 * Reads and clears the queued request. The panel calls this after a render in
 * which its search field exists, which is what delivers a request that arrived
 * while the panel was still loading.
 */
export function consumePendingInfoSearchFocus(): boolean {
  if (!pendingSearchFocus) return false
  pendingSearchFocus = false
  return true
}

/**
 * Asks the panel to close the dock. A mounted panel consults its draft guard
 * first; with no panel mounted there is no draft to lose, so the close runs
 * immediately.
 */
export function requestInfoPanelClose(close: () => void): void {
  if (handlers === null) {
    close()
    return
  }
  handlers.requestClose(close)
}

/** Test hook: forgets any binding or queued request. */
export function resetInfoPanelBridge(): void {
  handlers = null
  pendingSearchFocus = false
}
