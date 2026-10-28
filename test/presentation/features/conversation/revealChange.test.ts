/**
 * @file revealChange.test
 * @description Opening rules for the locate action: a closed dock opens the one
 * panel, an open dock gains the other, a two-pane dock stays two-pane.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { showPanel } from '../../../../src/presentation/features/conversation/revealChange'
import { useShellStore } from '../../../../src/presentation/app/stores/shellStore'

afterEach(() => {
  useShellStore.setState({ rightPanel: 'none' })
})

describe('showPanel', () => {
  it('opens the requested panel when the dock is closed', () => {
    useShellStore.setState({ rightPanel: 'none' })

    showPanel('resume')

    expect(useShellStore.getState().rightPanel).toBe('resume')
  })

  it('adds the requested panel beside the open one', () => {
    useShellStore.setState({ rightPanel: 'info' })

    showPanel('resume')

    expect(useShellStore.getState().rightPanel).toBe('both')
  })

  it('keeps a two-pane dock as it is', () => {
    useShellStore.setState({ rightPanel: 'both' })

    showPanel('info')

    expect(useShellStore.getState().rightPanel).toBe('both')
  })
})
