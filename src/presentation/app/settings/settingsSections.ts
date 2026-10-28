/**
 * @file settingsSections
 * @description The five sections of the settings overlay: their navigation
 * labels, their headings and the sentence that says what the section is for.
 */

import type { IconName } from '../components/Icon'
import type { SettingsSectionId } from '../stores/shellStore'

export interface SettingsSectionMeta {
  readonly navLabel: string
  readonly title: string
  readonly description: string
  readonly icon: IconName
}

export const SETTINGS_SECTION_META: Readonly<Record<SettingsSectionId, SettingsSectionMeta>> = {
  appearance: {
    navLabel: '外观',
    title: '外观',
    description: '主题、明暗、密度与动效。改动立即生效。',
    icon: 'palette',
  },
  interaction: {
    navLabel: '交互',
    title: '交互',
    description: '界面缩放与键盘快捷键。',
    icon: 'keyboard',
  },
  model: {
    navLabel: '模型服务',
    title: '模型服务',
    description: '简历助手使用的模型服务连接。',
    icon: 'plug',
  },
  data: {
    navLabel: '数据',
    title: '数据',
    description: '本地数据库的位置、备份与示例数据。',
    icon: 'database',
  },
  about: {
    navLabel: '关于',
    title: '关于',
    description: '版本、构建信息与许可证。',
    icon: 'info',
  },
}
