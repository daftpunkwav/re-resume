/**
 * @file stickToBottom.test
 * @description The transcript re-pins itself to the newest message both when new
 * messages arrive and when an image finishes painting. A late image grows the
 * content and can make the browser emit a scroll event without the reader moving;
 * that event must not unstick the transcript.
 */

import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useStickToBottom } from '../../src/presentation/features/conversation/hooks'

function StickToBottomHarness() {
  const [blocks, setBlocks] = useState(2)
  const { containerRef, atBottom, followIfAtBottom } = useStickToBottom(blocks)
  return (
    <div>
      <div
        ref={containerRef}
        data-testid="transcript"
        style={{ height: 120, overflowY: 'auto' }}
      >
        <div data-testid="content" style={{ height: blocks * 200 }} />
      </div>
      <span data-testid="at-bottom">{atBottom ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => setBlocks((current) => current + 2)}>
        长高
      </button>
      <button type="button" onClick={() => followIfAtBottom()}>
        跟随
      </button>
    </div>
  )
}

describe('useStickToBottom', () => {
  it('stays pinned when content grows and the browser fires a scroll event without movement', () => {
    render(<StickToBottomHarness />)
    const transcript = screen.getByTestId('transcript')
    const content = screen.getByTestId('content')
    expect(transcript.scrollTop).toBeGreaterThan(0)
    expect(screen.getByTestId('at-bottom')).toHaveTextContent('yes')

    // An image paints and grows the row: scrollHeight jumps while scrollTop stays
    // where it was, and the browser emits a scroll event for the layout change.
    content.style.height = '900px'
    fireEvent.scroll(transcript)

    expect(screen.getByTestId('at-bottom')).toHaveTextContent('yes')
    fireEvent.click(screen.getByRole('button', { name: '跟随' }))
    expect(transcript.scrollTop).toBeGreaterThan(0)
  })

  it('follows new messages through the content key', () => {
    render(<StickToBottomHarness />)
    const transcript = screen.getByTestId('transcript')
    const before = transcript.scrollTop

    fireEvent.click(screen.getByRole('button', { name: '长高' }))

    expect(transcript.scrollTop).toBeGreaterThan(before)
  })

  it('does not pin the transcript after the reader scrolls up', () => {
    render(<StickToBottomHarness />)
    const transcript = screen.getByTestId('transcript')
    fireEvent.scroll(transcript, { target: { scrollTop: 0 } })
    expect(screen.getByTestId('at-bottom')).toHaveTextContent('no')

    fireEvent.click(screen.getByRole('button', { name: '长高' }))
    expect(transcript.scrollTop).toBe(0)
  })
})
