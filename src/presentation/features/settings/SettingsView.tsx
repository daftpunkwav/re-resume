/**
 * @file SettingsView
 * @description The settings section: the two things the user configures by
 * hand, the personal profile and the model service. They share no state, so
 * they are separate tabs rather than one scrolling page.
 *
 * Responsibilities:
 * - Own which settings tab is showing
 * - Mount exactly one form, so an abandoned edit is not carried across tabs
 *
 * Constraints:
 * - This module must not reach for services or stores. Each form owns the
 *   service it needs, so this one only decides what is on screen.
 */

import { useState } from 'react'
import { Tabs } from '../../app/components/Tabs'
import type { TabDescriptor } from '../../app/components/Tabs'
import { ProfileForm } from './ProfileForm'
import { ProviderForm } from './ProviderForm'
import './settings.css'

type SettingsTab = 'profile' | 'provider'

const TABS: readonly TabDescriptor<SettingsTab>[] = [
  { id: 'profile', label: '个人资料' },
  { id: 'provider', label: '模型服务' },
]

export function SettingsView() {
  const [active, setActive] = useState<SettingsTab>('profile')

  return (
    <div className="stack">
      <Tabs tabs={TABS} active={active} onChange={setActive}>
        {active === 'profile' ? <ProfileForm /> : <ProviderForm />}
      </Tabs>
    </div>
  )
}
