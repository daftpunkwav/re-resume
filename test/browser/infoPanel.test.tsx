/**
 * @file infoPanel.browser.test
 * @description What only a real browser can answer about the information
 * panel: that a keyboard-focused row paints the focus ring, that a native
 * drag and drop reorders the list, and that the panel folds its regions when
 * its own width crosses a tier.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../src/presentation/app/ApplicationServicesProvider'
import { InfoPanel } from '../../src/presentation/features/info/InfoPanel'
import {
  resetInfoStore,
  useInfoStore,
} from '../../src/presentation/features/info/stores/infoStore'
import { resetInfoPanelBridge } from '../../src/presentation/features/info/panelBridge'
import { createInfoService } from '../../src/bootstrap/wiring/info'
import { DEFAULT_APP_SETTINGS } from '../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../src/presentation/app/stores/settingsStore'
import { infoEntryFixture } from '../support/infoFixtures'
import { newInfoLibrary } from '../support/infoLibrary'
import { stubCompositionRoot } from '../support/stubCompositionRoot'
import '../../src/presentation/styles'

const user = userEvent.setup({ delay: null })

function personalEntry() {
  return infoEntryFixture({
    id: 'personal-1',
    moduleKind: 'personal',
    fields: { fullName: '张三' },
  })
}

function educationEntry(id: string, sortOrder: number, school: string) {
  return infoEntryFixture({
    id,
    moduleKind: 'education',
    sortOrder,
    fields: {
      school,
      degree: 'master',
      startDate: '2021-09',
      endDate: 'present',
    },
  })
}

let host: HTMLDivElement

function renderPanel(): void {
  const library = newInfoLibrary({
    entries: [
      personalEntry(),
      educationEntry('edu-1', 1, '复旦大学'),
      educationEntry('edu-2', 2, '同济大学'),
    ],
  })
  const root = stubCompositionRoot({ info: createInfoService(library.deps) })
  host = document.createElement('div')
  host.style.width = '720px'
  host.style.height = '640px'
  host.style.display = 'flex'
  document.body.append(host)
  render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <InfoPanel />
    </ApplicationServicesProvider>,
    { container: host },
  )
}

async function openEducation(): Promise<void> {
  const nav = await screen.findByRole('navigation', { name: '信息模块' })
  await user.click(within(nav).getByRole('button', { name: /^教育经历/ }))
  await screen.findByRole('list', { name: '教育经历条目' })
}

beforeEach(() => {
  resetInfoStore()
  resetInfoPanelBridge()
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
})

afterEach(() => {
  cleanup()
  host?.remove()
  resetInfoStore()
  resetInfoPanelBridge()
})

describe('the information panel in a browser', () => {
  it('paints the focus ring on a row reached with the keyboard', async () => {
    renderPanel()
    await openEducation()

    const row = await waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>('.info-entry-button')
      if (found === null) throw new Error('the entry row is not rendered yet')
      return found
    })
    for (let step = 0; step < 40; step += 1) {
      if (document.activeElement === row) break
      await user.tab()
    }
    expect(document.activeElement).toBe(row)

    const computed = getComputedStyle(row)
    expect(computed.outlineStyle).toBe('solid')
    expect(computed.outlineWidth).toBe('2px')
    expect(computed.outlineOffset).toBe('2px')
  })

  it('reorders entries through native HTML5 drag and drop', async () => {
    renderPanel()
    await openEducation()

    const rows = [...document.querySelectorAll<HTMLElement>('[data-entry-id]')]
    const [first, second] = rows
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(useInfoStore.getState().entries.filter((entry) => entry.moduleKind === 'education'))
      .toHaveLength(2)

    const transfer = new DataTransfer()
    act(() => {
      first?.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      )
    })
    await waitFor(() => {
      expect(first).toHaveAttribute('data-dragging', 'true')
    })

    const rect = second!.getBoundingClientRect()
    const clientY = rect.top + rect.height * 0.75
    act(() => {
      second?.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientY,
        }),
      )
      second?.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientY,
        }),
      )
    })

    await waitFor(() => {
      const titles = useInfoStore
        .getState()
        .entries.filter((entry) => entry.moduleKind === 'education')
        .map((entry) => entry.title)
      expect(titles).toEqual(['同济大学（硕士）', '复旦大学（硕士）'])
    })
  })

  it('folds the module column into a picker when the panel narrows', async () => {
    renderPanel()
    await openEducation()
    expect(screen.getByRole('navigation', { name: '信息模块' })).toBeInTheDocument()

    host.style.width = '420px'
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: '信息模块' })).toBeNull()
    })
    // The open entry stays in a single-column detail view; the list behind it
    // is what shows the collapsed module picker.
    await user.click(await screen.findByRole('button', { name: '返回条目列表' }))
    expect(await screen.findByRole('combobox', { name: '模块' })).toBeInTheDocument()
  })
})
