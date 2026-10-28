/**
 * @file EmptyConversation
 * @description The welcome region of a session that has no messages yet: what
 * the assistant is for, three things to do next, and the setup warning when no
 * model service is configured.
 *
 * Constraints:
 * - Every quick action does what it says. The job-description action opens a
 *   paste dialog and sends the pasted text as the first user turn; the sample
 *   action imports the sample library; the last one switches to the information
 *   panel.
 */

import { useState } from 'react'
import { useApplicationRebuild, useServices } from '../../app/ApplicationServicesProvider'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'
import { TextAreaField } from '../../app/components/TextAreaField'
import { messageOf } from '../../app/settings/settingsErrors'
import { useSettingsStore } from '../../app/stores/settingsStore'
import { useShellStore } from '../../app/stores/shellStore'
import { showToast } from '../../app/stores/toastStore'
import type { FeatureIconName } from './icons'
import { FeatureIcon } from './icons'
import { useProviderStore } from './stores/providerStore'
import { useConversationStore } from './stores/conversationStore'

interface QuickAction {
  readonly icon: FeatureIconName
  readonly title: string
  readonly description: string
  readonly onClick: () => void
}

export function EmptyConversation() {
  const sendMessage = useConversationStore((state) => state.sendMessage)
  const providerStatus = useProviderStore((state) => state.status)
  const providers = useProviderStore((state) => state.providers)
  const setRightPanel = useShellStore((state) => state.setRightPanel)
  const openSettings = useShellStore((state) => state.openSettings)
  const [pasting, setPasting] = useState(false)
  const [jobPosting, setJobPosting] = useState('')
  const missingModel = providerStatus === 'ready' && providers.length === 0
  const services = useServices()
  const rebuild = useApplicationRebuild()
  const sampleDataSeeded = useSettingsStore((state) => state.settings.sampleDataSeeded)
  const [seeding, setSeeding] = useState(false)

  const seed = async (): Promise<void> => {
    if (seeding) return
    setSeeding(true)
    try {
      await services.seed.seedSampleData()
      showToast('success', '示例数据已导入，正在重新加载本地数据')
      rebuild()
    } catch (failure) {
      showToast('danger', messageOf(failure))
    } finally {
      setSeeding(false)
    }
  }

  const quickActions: readonly QuickAction[] = [
    {
      icon: 'clipboard',
      title: '粘贴岗位描述',
      description: '把招聘要求发给助手，让它按岗位整理简历。',
      onClick: () => setPasting(true),
    },
    ...(sampleDataSeeded
      ? []
      : [
          {
            icon: 'sparkles' as const,
            title: '导入示例数据',
            description: '填入一位虚构候选人的完整资料，先看看完整效果。',
            onClick: () => {
              void seed()
            },
          },
        ]),
    {
      icon: 'pencil',
      title: '完善我的信息',
      description: '在右侧信息面板补充经历，助手只会使用你写下的内容。',
      onClick: () => setRightPanel('info'),
    },
  ]

  return (
    <div className="conversation-empty">
      <div className="welcome">
        <span className="welcome-mark" aria-hidden="true">
          R
        </span>
        <p className="welcome-eyebrow">简历助手</p>
        <h2 className="welcome-title">从一段对话开始</h2>
        <p className="welcome-lead">
          告诉助手目标岗位，它会从你的简历信息中挑选合适的经历，组装成一份针对这份工作的简历。
          你也可以直接让它改写某段经历，或检查简历是否遗漏了关键信息。
        </p>
        {missingModel ? (
          <Notice
            tone="warning"
            title="还没有可用的模型服务"
            actions={
              <Button size="small" variant="secondary" onClick={() => openSettings('model')}>
                去配置
              </Button>
            }
          >
            <p>助手通过模型服务生成回答。配置地址、模型名称与 API Key 后即可开始对话。</p>
          </Notice>
        ) : null}
        <div className="quick-actions">
          {quickActions.map((action) => (
            <button
              type="button"
              className="quick-action"
              key={action.title}
              onClick={action.onClick}
            >
              <span className="quick-action-icon" aria-hidden="true">
                <FeatureIcon name={action.icon} size={16} />
              </span>
              <span className="quick-action-copy">
                <span className="quick-action-title">{action.title}</span>
                <span className="quick-action-description">{action.description}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="welcome-footnote">
          对话保存在本机。助手不会编造你没有提供的经历与数字，随时可以停止生成或撤销它的修改。
        </p>
      </div>

      <Dialog
        open={pasting}
        title="粘贴岗位描述"
        description="把招聘页面上的岗位描述粘贴到这里，作为这段对话的第一条消息。"
        confirmLabel="发送给助手"
        busy={jobPosting.trim() === ''}
        onClose={() => setPasting(false)}
        onConfirm={() => {
          const text = jobPosting.trim()
          if (text === '') return
          setPasting(false)
          setJobPosting('')
          void sendMessage(text, [])
        }}
      >
        <TextAreaField
          label="岗位描述"
          rows={8}
          value={jobPosting}
          placeholder="例如：负责前端页面开发，熟悉 React 与 TypeScript……"
          onChange={(event) => setJobPosting(event.target.value)}
        />
      </Dialog>
    </div>
  )
}
