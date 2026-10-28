/**
 * @file markdown.test
 * @description The Markdown contract: raw HTML is dropped, only the safe schemes
 * survive the URL transform, and a link click copies instead of navigating.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Markdown, safeUrlTransform } from '../../../../src/presentation/features/conversation/Markdown'

const writeText = vi.fn(async () => undefined)

describe('safeUrlTransform', () => {
  it('keeps the allowed schemes and relative paths', () => {
    expect(safeUrlTransform('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeUrlTransform('http://localhost:3000/x')).toBe('http://localhost:3000/x')
    expect(safeUrlTransform('mailto:someone@example.com')).toBe('mailto:someone@example.com')
    expect(safeUrlTransform('docs/readme.md')).toBe('docs/readme.md')
    expect(safeUrlTransform('/local/path')).toBe('/local/path')
    expect(safeUrlTransform('#section')).toBe('#section')
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example.com/x',
    'https://example.com\\@evil.example.com',
    '   ',
  ])('drops %j', (url) => {
    expect(safeUrlTransform(url)).toBe('')
  })
})

describe('Markdown', () => {
  beforeEach(() => {
    // jsdom exposes `navigator.clipboard` as a getter; the copy action under test
    // needs a spy it can assert on.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    writeText.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders GFM tables, task lists and emphasis', () => {
    render(
      <Markdown
        markdown={'## 标题\n\n- [x] 已完成\n- [ ] 待办\n\n| 项目 | 状态 |\n| --- | --- |\n| 订单 | 完成 |\n\n**重点**'}
      />,
    )

    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '项目' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText('重点')).toBeInTheDocument()
  })

  it('drops raw HTML instead of rendering it or keeping its text', () => {
    const { container } = render(
      <Markdown markdown={'前文\n\n<script>window.alert("x")</script>\n\n<img src="x" onerror="alert(1)">\n\n后文'} />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText(/window\.alert/)).toBeNull()
    expect(screen.getByText(/前文/)).toBeInTheDocument()
    expect(screen.getByText(/后文/)).toBeInTheDocument()
  })

  it('renders a dangerous link without a target and a safe link as an action', async () => {
    const user = userEvent.setup({ delay: null })
    // user-event installs its own clipboard when it is set up, so the spy is
    // installed after it; the component is expected to write to the real API.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<Markdown markdown={'[危险](javascript:alert(1)) 与 [安全](https://example.com/doc)'} />)

    const links = screen.getAllByText(/危险|安全/)
    const dangerous = links[0] as HTMLElement
    expect(dangerous.closest('a')).toBeNull()

    const safe = screen.getByText('安全').closest('a')
    expect(safe).toHaveAttribute('href', 'https://example.com/doc')
    expect(safe).toHaveAttribute('target', '_blank')
    expect(safe).toHaveAttribute('rel', 'noreferrer noopener')

    // A click opens the copy bubble instead of navigating away from the window.
    await user.click(screen.getByText('安全'))
    expect(await screen.findByRole('dialog', { name: '链接操作' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /复制链接/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/doc'))
  })

  it('renders fenced code without a highlighter dependency', () => {
    const { container } = render(<Markdown markdown={'```ts\nconst answer = 42\n```'} />)
    const code = container.querySelector('pre code')
    expect(code?.textContent).toContain('const answer = 42')
    expect(code?.querySelector('span')).toBeNull()
  })

  it('shows a link bubble that closes with Escape', async () => {
    render(<Markdown markdown={'[安全](https://example.com)'} />)
    fireEvent.click(screen.getByText('安全'))
    expect(await screen.findByRole('dialog', { name: '链接操作' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '链接操作' })).toBeNull()
  })
})
