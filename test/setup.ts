import '@testing-library/jest-dom/vitest'

/**
 * jsdom implements neither ResizeObserver nor a layout engine: every element
 * reports a zero box and never changes size on its own. The double below is
 * just enough for a component that observes its own host element, and it is
 * driven by hand from the test — which is the point, since jsdom would
 * otherwise never fire it.
 */
export class TestResizeObserver implements ResizeObserver {
  /** Every double still watching something, across all mounted components. */
  static watching(): TestResizeObserver[] {
    return TestResizeObserver.live.filter((observer) => observer.targets.length > 0)
  }

  private static live: TestResizeObserver[] = []

  readonly targets: Element[] = []

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.live.push(this)
  }

  observe(target: Element): void {
    this.targets.push(target)
  }

  unobserve(target: Element): void {
    const at = this.targets.indexOf(target)
    if (at >= 0) this.targets.splice(at, 1)
  }

  disconnect(): void {
    this.targets.length = 0
    const at = TestResizeObserver.live.indexOf(this)
    if (at >= 0) TestResizeObserver.live.splice(at, 1)
  }

  /** Reports a new size for every watched target, as the browser would. */
  report(width: number, height: number): void {
    this.callback(
      this.targets.map((target) => resizeEntry(target, width, height)),
      this,
    )
  }
}

function resizeEntry(target: Element, width: number, height: number): ResizeObserverEntry {
  const box = { width, height }
  return {
    target,
    contentRect: box,
    borderBoxSize: [box],
    contentBoxSize: [box],
    devicePixelContentBoxSize: [box],
  } as unknown as ResizeObserverEntry
}

globalThis.ResizeObserver = TestResizeObserver
