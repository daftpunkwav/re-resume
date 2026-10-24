/**
 * @file main
 * @description Window entry point. The appearance is applied before React mounts
 * so the first paint already carries the saved palette.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles'
import { ApplicationServicesProvider } from './app/ApplicationServicesProvider'
import { AppShell } from './app/AppShell'
import { applyAppearance, useAppearance, useAppearanceEffect } from './app/theme/useAppearance'
import { resolveColorScheme } from './app/theme/themes'

function Root() {
  useAppearanceEffect()
  return (
    <ApplicationServicesProvider>
      <AppShell />
    </ApplicationServicesProvider>
  )
}

const appearance = useAppearance.getState()
applyAppearance(appearance.themeId, resolveColorScheme(appearance.colorSchemePreference))

const container = document.getElementById('root')
if (container === null) {
  throw new Error('The application root element is missing from index.html.')
}

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
