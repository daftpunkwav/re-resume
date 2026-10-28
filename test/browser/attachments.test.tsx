/**
 * @file attachments.test
 * @description What a real browser paints for image attachments: the composer
 * thumbnail from a pasted file, the thumbnail of a stored image message, and the
 * enlarged preview. jsdom cannot answer these because it has no object URLs.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'

import { ApplicationServicesProvider } from '../../src/presentation/app/ApplicationServicesProvider'
import { Composer } from '../../src/presentation/features/conversation/Composer'
import { MessageAttachments } from '../../src/presentation/features/conversation/attachments/MessageAttachments'
import { useConversationStore } from '../../src/presentation/features/conversation/stores/conversationStore'
import { stubCompositionRoot } from '../support/stubCompositionRoot'
import type { CompositionRoot } from '../../src/bootstrap/capabilities'

/** A real 1x1 PNG, so a browser can decode what the composer and message show. */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function pngFile(name: string): File {
  const binary = atob(ONE_PIXEL_PNG_BASE64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new File([bytes], name, { type: 'image/png' })
}

function pngBytes(): Uint8Array {
  const binary = atob(ONE_PIXEL_PNG_BASE64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function connect(root: CompositionRoot): Promise<void> {
  useConversationStore.getState().connect({
    conversation: root.conversation,
    info: root.info,
    settings: root.settings,
    libraryChanges: root.libraryChanges,
  })
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function renderWithRoot(root: CompositionRoot, child: ReactElement) {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => '/tmp/credentials.hold'}
    >
      {child}
    </ApplicationServicesProvider>,
  )
}

describe('image attachments in a browser', () => {
  it('shows a pasted image as a thumbnail chip and enables sending', async () => {
    const root = stubCompositionRoot()
    await connect(root)
    renderWithRoot(root, <Composer inputRef={{ current: null }} />)
    const input = await screen.findByRole('textbox', { name: '输入消息' })

    const transfer = new DataTransfer()
    transfer.items.add(pngFile('职位截图.png'))
    // A real ClipboardEvent carries the transfer; the synthetic init object
    // testing-library builds cannot set the read-only clipboardData in Chromium.
    fireEvent(
      input,
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    )

    const chipName = await screen.findByText('职位截图.png')
    const chip = chipName.closest('li')
    expect(chip).not.toBeNull()
    const thumbnail = chip?.querySelector('img')
    expect(thumbnail).not.toBeNull()
    expect(thumbnail?.getAttribute('src')).toMatch(/^blob:/)
    expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled()
  })

  it('paints a stored image message and opens the enlarged preview', async () => {
    const root = stubCompositionRoot()
    const attachment = await root.conversation.ingestAttachment({
      kind: 'image',
      mimeType: 'image/png',
      bytes: pngBytes(),
    })
    renderWithRoot(root, <MessageAttachments attachments={[attachment]} />)

    const list = await screen.findByRole('list', { name: '随消息发送的图片' })
    const button = within(list).getByRole('button', { name: '查看图片：图片 1' })
    await waitFor(() => {
      expect(button.querySelector('img')).not.toBeNull()
    })
    expect(button.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/)

    await userEvent.setup({ delay: null }).click(button)
    const dialog = await screen.findByRole('dialog', { name: '图片预览：图片 1' })
    await waitFor(() => {
      expect(dialog.querySelector('img')).not.toBeNull()
    })
    expect(dialog.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/)
  })
})
