/**
 * @file conversationA11y.test
 * @description What a real browser paints for the conversation surface: the
 * composer's focus ring and the reduced-motion path of the message entrance.
 * jsdom cannot answer these because it neither resolves the cascade with the
 * feature stylesheet nor applies the outline. The transcript's roles are asserted
 * in the unit project, which can mount the full Markdown renderer.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../src/presentation/app/ApplicationServicesProvider'
import { Composer } from '../../src/presentation/features/conversation/Composer'
import { useConversationStore } from '../../src/presentation/features/conversation/stores/conversationStore'
import { stubCompositionRoot } from '../support/stubCompositionRoot'
import '../../src/presentation/styles'
import '../../src/presentation/features/conversation/conversation.css'

function accentColour(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--accent-text)'
  document.body.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

function renderComposer() {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => stubCompositionRoot()}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <Composer inputRef={{ current: null }} />
    </ApplicationServicesProvider>,
  )
}

describe('the conversation surface in a browser', () => {
  it('paints the composer focus ring in the theme accent', async () => {
    renderComposer()

    const input = (await screen.findByRole('textbox', { name: '输入消息' })) as HTMLTextAreaElement
    const composer = input.closest('.composer')
    expect(composer).not.toBeNull()
    expect(input).toBeInTheDocument()
    input.focus()
    expect(document.activeElement).toBe(input)

    // The rule transitions the border, so the painted value settles a frame
    // later; the assertion waits for the accent instead of sampling the start.
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000
      const check = (): void => {
        const computed = getComputedStyle(composer as Element)
        if (computed.borderColor === accentColour() && computed.boxShadow !== 'none') {
          resolve()
          return
        }
        if (Date.now() > deadline) {
          reject(new Error(`focus ring did not settle: ${computed.borderColor}`))
          return
        }
        window.requestAnimationFrame(check)
      }
      check()
    })
  })

  it('removes the message entrance motion when motion is disabled', () => {
    document.documentElement.dataset.motion = 'reduced'
    const probe = document.createElement('div')
    probe.className = 'message message-enter'
    probe.textContent = '新消息'
    document.body.append(probe)

    // Browsers serialise the reduced duration as either 0.01ms or 1e-05s.
    const duration = getComputedStyle(probe).animationDuration
    expect(duration === '0.01ms' || duration === '1e-05s').toBe(true)

    probe.remove()
    delete document.documentElement.dataset.motion
    // This file never holds a conversation; closing the store keeps the module
    // clean for a later test of the same worker.
    useConversationStore.getState().connect(null)
  })
})
