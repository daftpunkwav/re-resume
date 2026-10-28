/**
 * @file emptyComposer.test
 * @description The empty conversation in a real browser: the welcome layout must
 * leave the composer inside the window, and typing + sending must create the
 * conversation instead of staying on the welcome screen.
 *
 * jsdom cannot answer this: the failure mode is layout, and jsdom has no layout.
 * The second case is the regression found in the merge window: with no model
 * service configured the welcome carries an extra warning block, and the taller
 * state must keep the composer inside the window too.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../src/presentation/app/ApplicationServicesProvider'
import { AppShell } from '../../src/presentation/app/AppShell'
import { useConversationStore } from '../../src/presentation/features/conversation/stores/conversationStore'
import { useRunStore } from '../../src/presentation/features/conversation/stores/runStore'
import { stubCompositionRoot } from '../support/stubCompositionRoot'
import '../../src/presentation/styles'
import '../../src/presentation/features/conversation/conversation.css'

/** The stub root has no configured model provider, which is the taller state. */
function renderShell() {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => stubCompositionRoot()}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <AppShell />
    </ApplicationServicesProvider>,
  )
}

function inWindow(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0
}

afterEach(async () => {
  useConversationStore.getState().connect(null)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
})

describe('the empty conversation in a browser', () => {
  it('keeps the composer inside the window and starts a conversation from it', async () => {
    const user = userEvent.setup({ delay: null })
    renderShell()
    await screen.findByRole('button', { name: '新建对话' })
    await user.click(screen.getByRole('button', { name: '新建对话' }))

    // The no-provider state renders its warning; the composer must stay inside
    // the window for this taller welcome as well.
    expect(await screen.findByText('还没有可用的模型服务')).toBeInTheDocument()
    const input = (await screen.findByRole('textbox', { name: '输入消息' })) as HTMLTextAreaElement
    expect(inWindow(input)).toBe(true)
    expect(inWindow(input.closest('.composer') as Element)).toBe(true)

    await user.type(input, '帮我整理一份前端实习简历')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByText('从一段对话开始')).toBeNull(), {
      timeout: 4000,
    })
    expect(screen.getAllByText('帮我整理一份前端实习简历').length).toBeGreaterThan(0)
    // The scripted turn is still streaming; let it finish so the store does not
    // write after the test ended.
    await waitFor(() => expect(useRunStore.getState().status).toBe('idle'), { timeout: 8000 })
  })
})
