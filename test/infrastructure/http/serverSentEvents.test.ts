import { describe, expect, it } from 'vitest'
import { readServerSentEvents } from '../../../src/infrastructure/http/TauriHttpClient'

async function* fromText(body: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(body)
}

/**
 * Yields the body in fixed-size byte slices. A network read ends wherever the
 * transport says it does, so a frame delimiter and a multi-byte character both
 * land across chunk boundaries in practice; the size is picked so this fixture
 * reproduces that rather than assuming one chunk is one frame.
 */
async function* fromByteSlices(body: string, size: number): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(body)
  for (let start = 0; start < bytes.length; start += size) {
    yield bytes.slice(start, start + size)
  }
}

async function collect(body: string): Promise<readonly string[]> {
  const events: string[] = []
  for await (const event of readServerSentEvents(fromText(body))) events.push(event)
  return events
}

async function collectSliced(body: string, size: number): Promise<readonly string[]> {
  const events: string[] = []
  for await (const event of readServerSentEvents(fromByteSlices(body, size))) events.push(event)
  return events
}

describe('server-sent event framing', () => {
  it('dispatches each event separately instead of accumulating their data lines', async () => {
    const events = await collect('data: first\n\ndata: second\n\n')

    expect(events).toEqual(['first', 'second'])
  })

  it('joins the data lines of one event and keeps them out of the next', async () => {
    const events = await collect('data: a\ndata: b\n\ndata: c\n\n')

    expect(events).toEqual(['a\nb', 'c'])
  })

  it('skips comments and non-data fields', async () => {
    const events = await collect(': keep-alive\nevent: message\ndata: payload\n\n')

    expect(events).toEqual(['payload'])
  })

  it('dispatches a frame left unterminated at end of stream', async () => {
    const events = await collect('data: complete\n\ndata: truncated')

    expect(events).toEqual(['complete', 'truncated'])
  })

  it('reads the same events when reads split the delimiter and a character', async () => {
    // Three bytes per read: '你' alone is three bytes of a six-byte character,
    // and the blank line that ends an event is split every time.
    const body = 'data: 你好\n\ndata: 后面\n\n'

    expect(await collectSliced(body, 3)).toEqual(await collect(body))
  })
})
