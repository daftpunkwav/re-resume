import '@testing-library/jest-dom/vitest'

/**
 * The browser project runs in a real browser, so the jsdom setup does not
 * apply: it replaces the ResizeObserver with a double the test drives by
 * hand, and the browser has a real one that reports what it observes.
 */
