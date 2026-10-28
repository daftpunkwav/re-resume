/**
 * @file main
 * @description Window entry point. The saved appearance is applied before
 * React mounts so the first paint already carries the stored palette and
 * scale; the database value replaces it once the composition root is ready.
 *
 * Responsibilities:
 * - Apply the cached preferences synchronously
 * - Mount the workbench, or the browser preview when the window asked for it
 *
 * Constraints:
 * - The preview branch is development-only. The production bundle must not
 *   contain the preview assembly at all, which is why the module is imported
 *   dynamically inside the guard.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles'
import { ApplicationServicesProvider } from './app/ApplicationServicesProvider'
import { AppShell } from './app/AppShell'
import { currentSettings } from './app/stores/settingsStore'
import { applyAppearance } from './app/theme/applyAppearance'

applyAppearance(currentSettings())

// A rejection that nothing handled is recorded instead of disappearing; the
// window keeps running because no local data access depends on the failed task.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled]', event.reason)
})

const container = document.getElementById('root')
if (container === null) {
  throw new Error('The application root element is missing from index.html.')
}

async function mount(): Promise<void> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')) {
    const { mountPreviewWindow } = await import('./previewMain')
    mountPreviewWindow(container as HTMLElement)
    return
  }

  createRoot(container as HTMLElement).render(
    <StrictMode>
      <ApplicationServicesProvider>
        <AppShell />
      </ApplicationServicesProvider>
    </StrictMode>,
  )
}

void mount()
