/**
 * @file navigationStore
 * @description Which region the shell is showing and which record inside it is
 * selected. Selection lives here rather than in component state so the sidebar
 * and the detail pane stay in agreement.
 */

import { create } from 'zustand'

export const APP_SECTIONS = ['experience', 'resume', 'settings'] as const

export type AppSection = (typeof APP_SECTIONS)[number]

export interface NavigationState {
  readonly section: AppSection
  readonly selectedExperienceId: string | null
  readonly selectedResumeId: string | null
  showSection(section: AppSection): void
  selectExperience(id: string | null): void
  selectResume(id: string | null): void
}

export const useNavigation = create<NavigationState>((set) => ({
  section: 'experience',
  selectedExperienceId: null,
  selectedResumeId: null,
  showSection(section) {
    set({ section })
  },
  selectExperience(selectedExperienceId) {
    set({ selectedExperienceId })
  },
  selectResume(selectedResumeId) {
    set({ selectedResumeId })
  },
}))
