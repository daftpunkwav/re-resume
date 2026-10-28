/**
 * @file previewMain
 * @description Mounts the workbench against the in-memory preview root. Only
 * reached when the development server is opened with `?preview`.
 *
 * Constraints:
 * - Development only: the production bundle excludes this module and with it
 *   the preview assembly.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createPreviewRoot } from '../bootstrap/previewRoot'
import { ApplicationServicesProvider } from './app/ApplicationServicesProvider'
import { AppShell } from './app/AppShell'

export function mountPreviewWindow(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <ApplicationServicesProvider
        createRoot={async () => createPreviewRoot()}
        resolveSnapshotPath={async () => 'preview-credentials.hold'}
      >
        <AppShell />
      </ApplicationServicesProvider>
    </StrictMode>,
  )
}
