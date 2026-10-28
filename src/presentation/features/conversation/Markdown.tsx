/**
 * @file Markdown
 * @description Renders an assistant answer. Raw HTML is dropped, links are
 * restricted to the three safe schemes, and a link click opens a copy bubble
 * instead of leaving the window: the WebView has no granted handler for opening
 * an external target, and navigating away would discard the application state.
 *
 * Responsibilities:
 * - One place that decides how Markdown becomes DOM
 * - A URL transform that only lets https, http, mailto and relative paths through
 * - Link handling that copies the address rather than navigating
 * - Table and task-list support through remark-gfm
 *
 * Constraints:
 * - No syntax highlighter: the contract keeps code blocks readable with the
 *   theme's mono font and does not ship a highlighter dependency.
 * - Completed answers are memoised by the parent; this component itself does not
 *   hold state beyond the link bubble.
 */

import { memo, useEffect, useId, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { showToast } from '../../app/stores/toastStore'
import { FeatureIcon } from './icons'

const REMARK_PLUGINS = [remarkGfm]

/**
 * Keeps a link address only when it is safe to hand to the engine. A scheme this
 * build does not know, a protocol-relative address and anything script-shaped
 * are all transformed to the empty string, which renders the label without a
 * target rather than a misleading link.
 */
export function safeUrlTransform(url: string): string {
  const trimmed = url.trim()
  if (trimmed === '' || trimmed.startsWith('//') || trimmed.includes('\\')) return ''
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(trimmed)
  if (scheme === null) return trimmed
  const protocol = (scheme[1] ?? '').toLowerCase()
  if (protocol === 'http' || protocol === 'https' || protocol === 'mailto') return trimmed
  return ''
}

/** Copies a link and reports the outcome where the user is looking. */
async function copyAddress(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

function LinkWithCopy({
  href,
  children,
}: {
  readonly href?: string
  readonly children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const bubbleId = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    button.current?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && wrapper.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  if (href === undefined || href === '') return <span>{children}</span>

  return (
    <span className="markdown-link" ref={wrapper}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => {
          // The window must keep its state; a copy bubble is the useful action.
          event.preventDefault()
          setCopied(false)
          setOpen((current) => !current)
        }}
      >
        {children}
      </a>
      {open ? (
        <span className="markdown-link-bubble" role="dialog" aria-label="链接操作" id={bubbleId}>
          <code className="markdown-link-address">{href}</code>
          <button
            type="button"
            className="markdown-link-action"
            ref={button}
            onClick={() => {
              void copyAddress(href).then((ok) => {
                if (ok) {
                  setCopied(true)
                  showToast('success', '链接已复制')
                  return
                }
                showToast('danger', '复制失败，请手动选择链接文本')
              })
            }}
          >
            <FeatureIcon name="copy" size={13} />
            {copied ? '已复制' : '复制链接'}
          </button>
        </span>
      ) : null}
    </span>
  )
}

const COMPONENTS: Components = {
  a: LinkWithCopy,
  table: ({ children }) => (
    <div className="markdown-table-wrap">
      <table>{children}</table>
    </div>
  ),
}

export interface MarkdownProps {
  readonly markdown: string
}

export const Markdown = memo(function Markdown({ markdown }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
        urlTransform={safeUrlTransform}
        components={COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
})
