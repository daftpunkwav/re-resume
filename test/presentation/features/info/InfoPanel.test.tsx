/**
 * @file InfoPanel.test
 * @description The panel's behaviour as the reader meets it: the module and
 * entry lists, search, the typed form and its validation, dirty-draft guards,
 * reference-protected deletion, custom-module authoring and keyboard ordering.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { AppShell } from '../../../../src/presentation/app/AppShell'
import { InfoPanel } from '../../../../src/presentation/features/info/InfoPanel'
import { resetInfoPanelBridge } from '../../../../src/presentation/features/info/panelBridge'
import {
  resetInfoStore,
  useInfoStore,
} from '../../../../src/presentation/features/info/stores/infoStore'
import { createInfoService } from '../../../../src/bootstrap/wiring/info'
import { CUSTOM_MODULE_TITLE_FIELD_KEY } from '../../../../src/domain/info/CustomModule'
import type { InfoEntry } from '../../../../src/domain/info/InfoEntry'
import type { InfoEntryReference } from '../../../../src/domain/info/ports/InfoEntryReferenceQuery'
import type { CompositionRoot } from '../../../../src/bootstrap/capabilities'
import {
  asResumeId,
  asResumeSectionId,
} from '../../../../src/domain/shared/branded-id'
import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../../src/presentation/app/stores/shellStore'
import { customModuleFixture, infoEntryFixture } from '../../../support/infoFixtures'
import { newInfoLibrary, referencesFor } from '../../../support/infoLibrary'
import { stubCompositionRoot } from '../../../support/stubCompositionRoot'
import { TestResizeObserver } from '../../../setup'

const user = userEvent.setup({ delay: null })

function personalEntry(id = 'personal-1', fullName = '张三'): InfoEntry {
  return infoEntryFixture({
    id,
    moduleKind: 'personal',
    fields: { fullName, email: 'zhangsan@example.com', city: '上海' },
  })
}

function educationEntry(id: string, sortOrder: number, school: string): InfoEntry {
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

interface PanelOptions {
  readonly entries?: readonly InfoEntry[]
  readonly customModules?: readonly ReturnType<typeof customModuleFixture>[]
  readonly entryReferences?: Readonly<Record<string, readonly InfoEntryReference[]>>
  readonly onAddEntryToConversation?: (entry: InfoEntry) => void
}

function buildRoot(options: PanelOptions = {}): CompositionRoot {
  const library = newInfoLibrary({
    entries: options.entries ?? [personalEntry()],
    customModules: options.customModules,
    entryReferences:
      options.entryReferences === undefined
        ? undefined
        : referencesFor(options.entryReferences).byEntry,
  })
  return stubCompositionRoot({ info: createInfoService(library.deps) })
}

function renderPanel(options: PanelOptions = {}) {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => buildRoot(options)}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <div style={{ height: 640 }}>
        <InfoPanel {...(options.onAddEntryToConversation === undefined ? {} : { onAddEntryToConversation: options.onAddEntryToConversation })} />
      </div>
    </ApplicationServicesProvider>,
  )
}

/** Reports a new width to every live ResizeObserver double. */
async function reportPanelWidth(width: number): Promise<void> {
  await act(async () => {
    for (const observer of TestResizeObserver.watching()) observer.report(width, 640)
  })
}

/** Boots the provider, then widens the panel until the three columns appear. */
async function renderWide(options: PanelOptions = {}): Promise<ReturnType<typeof render>> {
  const result = renderPanel(options)
  await screen.findByRole('combobox', { name: '模块' })
  await settle()
  await reportPanelWidth(720)
  await screen.findByRole('navigation', { name: '信息模块' })
  return result
}

/** Lets the provider's boot promise and the panel's first read settle inside act. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function resetStores(): void {
  resetInfoStore()
  resetInfoPanelBridge()
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
  useShellStore.setState({
    rightPanel: 'none',
    rightWidth: 400,
    sidebarCollapsed: false,
    settingsOpen: false,
    settingsSection: 'appearance',
    focusDomain: 'conversation',
    draftEpoch: 0,
    lastOpenPanel: 'resume',
  })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
  resetStores()
})

describe('InfoPanel loading and navigation', () => {
  it('shows the module nav, the list and the first entry in the editor', async () => {
    await renderWide({
      entries: [
        personalEntry(),
        educationEntry('edu-1', 1, '复旦大学'),
        educationEntry('edu-2', 2, '同济大学'),
      ],
    })

    const nav = screen.getByRole('navigation', { name: '信息模块' })
    expect(within(nav).getByRole('button', { name: /个人信息/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(nav).getByRole('button', { name: /教育经历/ })).toBeInTheDocument()

    // The editor opens the first entry of the selected module.
    expect(await screen.findByRole('heading', { name: '张三' })).toBeInTheDocument()
    expect(screen.getByLabelText('姓名 *')).toHaveValue('张三')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('switches modules and lists that module entries', async () => {
    await renderWide({
      entries: [
        personalEntry(),
        educationEntry('edu-1', 1, '复旦大学'),
        educationEntry('edu-2', 2, '同济大学'),
      ],
    })

    await user.click(screen.getByRole('button', { name: /^教育经历/ }))

    const list = await screen.findByRole('list', { name: '教育经历条目' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: '复旦大学（硕士）' })).toBeInTheDocument()
  })

  it('filters the list, highlights the hit and offers a no-result state', async () => {
    await renderWide({
      entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学'), educationEntry('edu-2', 2, '同济大学')],
    })
    await user.click(screen.getByRole('button', { name: /^教育经历/ }))

    const search = screen.getByRole('textbox', { name: '搜索教育经历' })
    await user.type(search, '同济')

    const list = await screen.findByRole('list', { name: '教育经历条目' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('同济', { selector: 'mark' })).toBeInTheDocument()

    await user.type(search, 'zzz')
    expect(await screen.findByText('没有匹配的信息')).toBeInTheDocument()

    await user.clear(search)
    await waitFor(() => {
      expect(screen.getByRole('list', { name: '教育经历条目' })).toBeInTheDocument()
    })
  })

  it('works as a single column in a narrow drawer and returns from the editor', async () => {
    renderPanel({ entries: [personalEntry()] })
    const picker = await screen.findByRole('combobox', { name: '模块' })
    expect(picker).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '信息模块' })).toBeNull()

    const list = await screen.findByRole('list', { name: '个人信息条目' })
    await user.click(within(list).getByRole('button', { name: /^张三/ }))

    expect(await screen.findByRole('button', { name: '返回条目列表' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回条目列表' }))
    expect(await screen.findByRole('combobox', { name: '模块' })).toBeInTheDocument()
    expect(useInfoStore.getState().selectedEntryId).toBeNull()
  })
})

describe('InfoPanel editing', () => {
  it('creates an entry after validating the required fields', async () => {
    await renderWide({ entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学')] })
    await user.click(screen.getByRole('button', { name: /^教育经历/ }))
    await user.click(screen.getByRole('button', { name: '新建' }))

    expect(screen.getByRole('heading', { name: '新建教育经历' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(await screen.findByText('请填写学校。')).toBeInTheDocument()

    await user.type(screen.getByLabelText('学校 *'), '同济大学')
    await user.selectOptions(screen.getByLabelText('学历 *'), 'bachelor')
    await user.type(screen.getByLabelText('开始时间 *'), '2017-09')
    await user.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(useInfoStore.getState().entries).toHaveLength(3)
    })
    const list = screen.getByRole('list', { name: '教育经历条目' })
    expect(within(list).getByText('同济大学（本科）')).toBeInTheDocument()
  })

  it('refuses an end date before the start date', async () => {
    await renderWide({ entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学')] })
    await user.click(screen.getByRole('button', { name: /^教育经历/ }))

    // The stored end date is 至今; turning the ongoing state off frees the field.
    await user.click(screen.getByRole('switch', { name: '至今' }))
    const endDate = screen.getByLabelText('结束时间')
    await user.clear(endDate)
    await user.type(endDate, '2019-01')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('结束时间不能早于开始时间。')).toBeInTheDocument()
    expect(useInfoStore.getState().entries).toHaveLength(2)
  })

  it('reports an invalid email on the field that holds it', async () => {
    await renderWide({ entries: [personalEntry()] })

    const email = screen.getByLabelText('邮箱')
    await user.clear(email)
    await user.type(email, 'not-an-email')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('请输入有效的邮箱地址。')).toBeInTheDocument()
  })

  it('shows the load failure with a retry', async () => {
    const library = newInfoLibrary({ entries: [personalEntry()] })
    const base = createInfoService(library.deps)
    const failing: typeof base = {
      ...base,
      listEntries: async () => {
        throw new Error('database is locked')
      },
    }
    const root = stubCompositionRoot({ info: failing })
    render(
      <ApplicationServicesProvider
        createRoot={async () => root}
        resolveSnapshotPath={async () => 'test.credentials.hold'}
      >
        <InfoPanel />
      </ApplicationServicesProvider>,
    )

    expect(await screen.findByText('信息库没有加载出来')).toBeInTheDocument()
    expect(screen.getByText('database is locked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('guards a dirty draft when switching modules and can keep the draft', async () => {
    await renderWide({
      entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学')],
    })
    const name = screen.getByLabelText('姓名 *')
    await user.clear(name)
    await user.type(name, '李四')

    await user.click(screen.getByRole('button', { name: /^教育经历/ }))
    const dialog = await screen.findByRole('dialog', { name: '保存这条信息的修改？' })
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '保存这条信息的修改？' })).toBeNull()
    expect(useInfoStore.getState().selectedModule).toEqual({
      moduleKind: 'personal',
      customModuleId: null,
    })
    expect(screen.getByLabelText('姓名 *')).toHaveValue('李四')
  })

  it('discards a dirty draft when the prompt asks to', async () => {
    await renderWide({
      entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学')],
    })
    const name = screen.getByLabelText('姓名 *')
    await user.clear(name)
    await user.type(name, '李四')

    await user.click(screen.getByRole('button', { name: /^教育经历/ }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '保存这条信息的修改？' })).getByRole(
        'button',
        { name: '放弃修改' },
      ),
    )

    await waitFor(() => {
      expect(useInfoStore.getState().selectedModule?.moduleKind).toBe('education')
    })
    expect(screen.getByLabelText('学校 *')).toHaveValue('复旦大学')
  })

  it('saves a dirty draft before navigating', async () => {
    await renderWide({
      entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学')],
    })
    const name = screen.getByLabelText('姓名 *')
    await user.clear(name)
    await user.type(name, '李四')

    await user.click(screen.getByRole('button', { name: /^教育经历/ }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '保存这条信息的修改？' })).getByRole(
        'button',
        { name: '保存' },
      ),
    )

    await waitFor(() => {
      expect(useInfoStore.getState().selectedModule?.moduleKind).toBe('education')
    })
    expect(useInfoStore.getState().entries[0]?.title).toBe('李四')
  })

  it('reports a durable write refusal as a form-level notice', async () => {
    const library = newInfoLibrary({ entries: [personalEntry()] })
    const base = createInfoService(library.deps)
    const failing: typeof base = {
      ...base,
      updateEntry: async () => {
        throw new Error('磁盘没有响应')
      },
    }
    const root = stubCompositionRoot({ info: failing })
    render(
      <ApplicationServicesProvider
        createRoot={async () => root}
        resolveSnapshotPath={async () => 'test.credentials.hold'}
      >
        <InfoPanel />
      </ApplicationServicesProvider>,
    )
    const list = await screen.findByRole('list', { name: '个人信息条目' })
    await user.click(within(list).getByRole('button', { name: /^张三/ }))
    const name = screen.getByLabelText('姓名 *')
    await user.clear(name)
    await user.type(name, '李四')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('没有保存成功')).toBeInTheDocument()
    expect(screen.getByText('磁盘没有响应')).toBeInTheDocument()
  })
})

describe('InfoPanel deletion', () => {
  it('lists the referencing resume titles and deletes only after the second confirmation', async () => {
    const reference = {
      resumeId: asResumeId('resume-1'),
      resumeTitle: '后端工程师简历',
      sectionId: asResumeSectionId('section-1'),
    }
    await renderWide({
      entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学')],
      entryReferences: { 'personal-1': [reference] },
    })

    await user.click(screen.getByRole('button', { name: '删除「张三」' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '删除这条信息？' })).getByRole('button', {
        name: '删除',
      }),
    )

    const dialog = await screen.findByRole('dialog', { name: '这条信息仍被简历引用' })
    expect(within(dialog).getByText('后端工程师简历')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '仍然删除' }))

    await waitFor(() => {
      expect(useInfoStore.getState().entries.some((entry) => entry.id === 'personal-1')).toBe(
        false,
      )
    })
    expect(await screen.findByText('还没有个人信息')).toBeInTheDocument()
  })

  it('deletes an unreferenced entry after one confirmation', async () => {
    await renderWide({
      entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学'), educationEntry('edu-2', 2, '同济大学')],
    })
    await user.click(screen.getByRole('button', { name: /^教育经历/ }))
    await user.click(screen.getByRole('button', { name: '删除「复旦大学（硕士）」' }))

    const dialog = await screen.findByRole('dialog', { name: '删除这条信息？' })
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(useInfoStore.getState().entries).toHaveLength(2)
    })
    expect(useInfoStore.getState().selectedEntryId).not.toBeNull()
  })
})

describe('InfoPanel custom modules', () => {
  it('creates a custom module, then an entry inside it', async () => {
    await renderWide({ entries: [personalEntry()] })

    await user.click(screen.getByRole('button', { name: '新建模块' }))
    const dialog = await screen.findByRole('dialog', { name: '新建自定义模块' })
    await user.type(within(dialog).getByLabelText('模块名称 *'), '证书')
    await user.type(within(dialog).getByLabelText('字段 1 名称'), '证书名称')
    await user.click(within(dialog).getByRole('button', { name: '创建模块' }))

    await waitFor(() => {
      expect(useInfoStore.getState().customModules).toHaveLength(1)
    })
    const nav = screen.getByRole('navigation', { name: '信息模块' })
    await user.click(within(nav).getByRole('button', { name: /证书/ }))

    expect(await screen.findByRole('heading', { name: '证书' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新建' }))
    await user.type(screen.getByLabelText('标题 *'), 'CET-6')
    await user.type(screen.getByLabelText('证书名称'), '大学英语六级')
    await user.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(useInfoStore.getState().entries.some((entry) => entry.title === 'CET-6')).toBe(true)
    })
  })

  it('asks before removing a field that still holds values', async () => {
    const module = customModuleFixture()
    const entry = infoEntryFixture({
      id: 'cert-1',
      moduleKind: 'custom',
      customModule: module,
      fields: {
        title: 'CET-6',
        f_11111111: '大学英语六级',
      },
    })
    await renderWide({ entries: [entry], customModules: [module] })

    const nav = screen.getByRole('navigation', { name: '信息模块' })
    await user.click(within(nav).getByRole('button', { name: /证书/ }))
    expect(await screen.findByRole('heading', { name: '证书' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: '管理「证书」模块' }))
    const moduleDialog = screen.getByRole('dialog', { name: '编辑「证书」' })
    await user.click(within(moduleDialog).getAllByRole('button', { name: '删除字段' })[0]!)
    await user.click(within(moduleDialog).getByRole('button', { name: '保存' }))

    const dialog = await screen.findByRole('dialog', { name: '删除字段会清除已填写的内容' })
    expect(within(dialog).getByText(/会清除 1 条信息/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '清除并保存' }))

    await waitFor(() => {
      expect(useInfoStore.getState().customModules[0]?.fields).toHaveLength(1)
    })
    expect(useInfoStore.getState().entries[0]?.fields[CUSTOM_MODULE_TITLE_FIELD_KEY]).toBe('CET-6')
  })

  it('deletes a custom module only after reporting its cascade', async () => {
    const module = customModuleFixture()
    const entry = infoEntryFixture({
      id: 'cert-1',
      moduleKind: 'custom',
      customModule: module,
      fields: { title: 'CET-6', f_11111111: '大学英语六级' },
    })
    await renderWide({ entries: [personalEntry(), entry], customModules: [module] })

    const nav = screen.getByRole('navigation', { name: '信息模块' })
    await user.click(within(nav).getByRole('button', { name: /证书/ }))
    await user.click(await screen.findByRole('button', { name: '管理「证书」模块' }))
    await user.click(screen.getByRole('button', { name: '删除这个模块…' }))

    const dialog = await screen.findByRole('dialog', { name: '删除自定义模块「证书」？' })
    expect(within(dialog).getByText(/模块内的 1 条信息会一起删除/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '仍然删除' }))

    await waitFor(() => {
      expect(useInfoStore.getState().customModules).toHaveLength(0)
    })
    expect(useInfoStore.getState().entries).toHaveLength(1)
  })
})

describe('InfoPanel keyboard and agent collaboration', () => {
  it('reorders entries with Alt+ArrowDown', async () => {
    await renderWide({
      entries: [personalEntry(), educationEntry('edu-1', 1, '复旦大学'), educationEntry('edu-2', 2, '同济大学')],
    })
    await user.click(screen.getByRole('button', { name: /^教育经历/ }))
    const list = await screen.findByRole('list', { name: '教育经历条目' })
    const first = within(list).getByRole('button', { name: /^复旦大学/ })
    first.focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    await waitFor(() => {
      const titles = useInfoStore
        .getState()
        .entries.filter((entry) => entry.moduleKind === 'education')
        .map((entry) => entry.title)
      expect(titles).toEqual(['同济大学（硕士）', '复旦大学（硕士）'])
    })
  })

  it('shows the agent touch badge and exposes the add-to-conversation action', async () => {
    const addToConversation = vi.fn()
    const root = buildRoot({ entries: [personalEntry()] })
    render(
      <ApplicationServicesProvider
        createRoot={async () => root}
        resolveSnapshotPath={async () => 'test.credentials.hold'}
      >
        <InfoPanel onAddEntryToConversation={addToConversation} />
      </ApplicationServicesProvider>,
    )
    const list = await screen.findByRole('list', { name: '个人信息条目' })
    act(() => {
      useInfoStore.getState().markAgentTouched([useInfoStore.getState().entries[0]!.id], 'created')
    })
    expect(within(list).getByText('新增')).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: '将「张三」加入对话' }))
    expect(addToConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'personal-1' }),
    )
  })
})

describe('InfoPanel inside the workbench shell', () => {
  function setWindowWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
    window.dispatchEvent(new Event('resize'))
  }

  async function renderShell(): Promise<ReturnType<typeof render>> {
    const root = buildRoot({ entries: [personalEntry()] })
    const result = render(
      <ApplicationServicesProvider
        createRoot={async () => root}
        resolveSnapshotPath={async () => 'test.credentials.hold'}
      >
        <AppShell />
      </ApplicationServicesProvider>,
    )
    await screen.findByRole('heading', { name: '从一段对话开始' })
    await settle()
    return result
  }

  afterEach(() => {
    act(() => setWindowWidth(1024))
  })

  it('closes the dock through the unsaved-draft guard', async () => {
    setWindowWidth(1280)
    await renderShell()
    await user.click(screen.getByRole('button', { name: /^简历信息$/ }))

    const list = await screen.findByRole('list', { name: '个人信息条目' })
    await user.click(within(list).getByRole('button', { name: /^张三/ }))
    const name = await screen.findByLabelText('姓名 *')
    await user.clear(name)
    await user.type(name, '李四')

    await user.click(screen.getByRole('button', { name: '关闭面板' }))
    const dialog = await screen.findByRole('dialog', { name: '保存这条信息的修改？' })
    await user.click(within(dialog).getByRole('button', { name: '放弃修改' }))

    await waitFor(() => {
      expect(useShellStore.getState().rightPanel).toBe('none')
    })
    expect(useInfoStore.getState().entries[0]?.title).toBe('张三')
  })

  it('focuses the search field with Ctrl/Cmd+K and opens the panel first', async () => {
    setWindowWidth(1280)
    await renderShell()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    const search = await screen.findByRole('textbox', { name: '搜索个人信息' })
    expect(useShellStore.getState().rightPanel).toBe('info')
    await waitFor(() => {
      expect(document.activeElement).toBe(search)
    })
  })

  it('guards the drawer Escape with the unsaved-draft prompt', async () => {
    setWindowWidth(960)
    await renderShell()
    await user.click(screen.getByRole('button', { name: '简历信息' }))

    const list = await screen.findByRole('list', { name: '个人信息条目' })
    await user.click(within(list).getByRole('button', { name: /^张三/ }))
    const name = await screen.findByLabelText('姓名 *')
    await user.clear(name)
    await user.type(name, '李四')

    fireEvent.keyDown(window, { key: 'Escape' })
    const dialog = await screen.findByRole('dialog', { name: '保存这条信息的修改？' })
    await user.click(within(dialog).getByRole('button', { name: '取消' }))

    // Cancelling the prompt cancels the close: the drawer stays open with the
    // draft intact.
    expect(useShellStore.getState().rightPanel).toBe('info')
    expect(screen.getByLabelText('姓名 *')).toHaveValue('李四')
  })
})
