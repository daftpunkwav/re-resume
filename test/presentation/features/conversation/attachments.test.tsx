/**
 * @file attachments.test
 * @description The attachment surface in jsdom: paste and remove in the
 * composer, the limits reported inline, the warning for a text-only model, the
 * image row of a sent turn and its lightbox.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { Composer } from '../../../../src/presentation/features/conversation/Composer'
import { MessageAttachments } from '../../../../src/presentation/features/conversation/attachments/MessageAttachments'
import { UserBubble } from '../../../../src/presentation/features/conversation/MessageItem'
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import { useProviderStore } from '../../../../src/presentation/features/conversation/stores/providerStore'
import { stubCompositionRoot } from '../../../support/stubCompositionRoot'
import { TestResizeObserver } from '../../../setup'
import type { CompositionRoot } from '../../../../src/bootstrap/capabilities'

function imageFile(name: string, marker: number): File {
  const bytes = new Uint8Array(64)
  bytes[0] = marker
  return new File([bytes], name, { type: 'image/png' })
}

function clipboardWith(files: readonly File[]): { files: readonly File[]; items: [] } {
  return { files, items: [] }
}

interface Rendered {
  readonly root: CompositionRoot
}

function renderWithRoot(
  root: CompositionRoot,
  children: ReactElement,
): Rendered {
  render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => '/tmp/credentials.hold'}
    >
      {children}
    </ApplicationServicesProvider>,
  )
  return { root }
}

async function connectConversation(root: CompositionRoot): Promise<void> {
  useConversationStore.getState().connect({
    conversation: root.conversation,
    info: root.info,
    settings: root.settings,
    libraryChanges: root.libraryChanges,
  })
  await waitFor(() => {
    expect(useConversationStore.getState().listStatus).not.toBe('loading')
  })
}

/** Renders the composer with the conversation store attached to the root. */
async function renderComposer(): Promise<void> {
  const root = stubCompositionRoot()
  await connectConversation(root)
  renderWithRoot(root, <Composer inputRef={{ current: null }} />)
  await screen.findByRole('textbox', { name: '输入消息' })
}

beforeEach(() => {
  useConversationStore.getState().connect(null)
  useProviderStore.setState({
    providers: [],
    activeProviderId: null,
    status: 'ready',
    error: null,
    tested: {},
    testing: new Set<string>(),
  })
})

describe('the composer attachments', () => {
  it('adds a pasted image, names it and removes it again', async () => {
    await renderComposer()

    const input = screen.getByRole('textbox', { name: '输入消息' })
    fireEvent.paste(input, { clipboardData: clipboardWith([imageFile('职位截图.png', 1)]) })

    const chip = await screen.findByText('职位截图.png')
    expect(chip).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '本轮附带的图片' })).toBeInTheDocument()
    expect(useConversationStore.getState().composer.attachments).toHaveLength(1)

    await userEvent.setup({ delay: null }).click(screen.getByRole('button', { name: '移除职位截图.png' }))
    await waitFor(() => {
      expect(screen.queryByText('职位截图.png')).toBeNull()
    })
    expect(useConversationStore.getState().composer.attachments).toEqual([])
  })

  it('reports an oversized paste next to the chips', async () => {
    await renderComposer()
    const input = screen.getByRole('textbox', { name: '输入消息' })
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', {
      type: 'image/png',
    })

    fireEvent.paste(input, { clipboardData: clipboardWith([oversized]) })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('单个附件不能超过')
    expect(useConversationStore.getState().composer.attachments).toEqual([])
  })

  it('blocks sending an image to a model that cannot read images', async () => {
    useProviderStore.setState({
      status: 'ready',
      activeProviderId: 'provider-text',
      providers: [
        {
          config: {
            id: 'provider-text',
            name: '纯文本模型',
            kind: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'gpt-3.5-turbo',
            secretRef: 'provider:provider-text',
            supportsImages: null,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z' as never,
            updatedAt: '2026-01-01T00:00:00.000Z' as never,
          },
          hasCredential: true,
          supportsImages: false,
        },
      ],
    })
    await renderComposer()
    const input = screen.getByRole('textbox', { name: '输入消息' })
    fireEvent.paste(input, { clipboardData: clipboardWith([imageFile('shot.png', 2)]) })

    await screen.findByText('shot.png')
    expect(
      screen.getByText(/当前模型不支持图片输入/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
  })
})

describe('the image row of a user turn', () => {
  it('renders the thumbnails and opens the lightbox', async () => {
    const root = stubCompositionRoot()
    const attachment = await root.conversation.ingestAttachment({
      kind: 'image',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 4]),
    })
    renderWithRoot(
      root,
      <MessageAttachments attachments={[attachment]} />,
    )

    const list = await screen.findByRole('list', { name: '随消息发送的图片' })
    const button = within(list).getByRole('button', { name: '查看图片：图片 1' })
    await userEvent.setup({ delay: null }).click(button)

    const dialog = await screen.findByRole('dialog', { name: '图片预览：图片 1' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/image\/png/)).toBeInTheDocument()
  })

  it('shows the text and the images of one bubble', async () => {
    const root = stubCompositionRoot()
    const attachment = await root.conversation.ingestAttachment({
      kind: 'image',
      mimeType: 'image/png',
      bytes: new Uint8Array([5, 6, 7]),
    })
    renderWithRoot(
      root,
      <UserBubble
        text="帮我针对这个岗位做简历"
        contexts={[]}
        attachments={[attachment]}
        contextEntries={{}}
        enter={false}
      />,
    )

    expect(await screen.findByText('帮我针对这个岗位做简历')).toBeInTheDocument()
    expect(await screen.findByRole('list', { name: '随消息发送的图片' })).toBeInTheDocument()
  })
})

describe('the composer toolbar in a narrow column', () => {
  it('drops the shortcut hint when the composer is too narrow for it', async () => {
    await renderComposer()
    const composer = document.querySelector('.composer')
    expect(composer).not.toBeNull()
    const element = composer as HTMLElement
    expect(element).not.toHaveAttribute('data-compact')

    const observer = TestResizeObserver.watching().find((candidate) =>
      candidate.targets.includes(element),
    )
    expect(observer).toBeDefined()
    act(() => {
      observer?.report(320, 180)
    })
    expect(element).toHaveAttribute('data-compact', 'true')

    act(() => {
      observer?.report(640, 180)
    })
    expect(element).not.toHaveAttribute('data-compact')
  })
})
