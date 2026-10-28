/**
 * @file EmptyConversation
 * @description The welcome region of a session that has no messages yet: what
 * the assistant is for, three things to do next, and the setup warning when no
 * model service is configured.
 *
 * Constraints:
 * - Every quick action does what it says. The job-description action opens a
 *   paste dialog and sends the pasted text as the first user turn; the other two
 *   switch the workspace to the panel that owns the task.
 */

import { useState } from 'react'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'
import { TextAreaField } from '../../app/components/TextAreaField'
import { useShellStore } from '../../app/stores/shellStore'
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

  const actions: readonly QuickAction[] = [
    {
      icon: 'clipboard',
      title: '粘贴岗位描述',
      description: '把招聘要求发给助手，让它按岗位整理简历。',
      onClick: () => setPasting(true),
    },
    {
      icon: 'pencil',
      title: '完善我的信息',
      description: '在右侧信息面板补充经历，助手只会使用你写下的内容。',
      onClick: () => setRightPanel('info'),
    },
    {
      icon: 'plug',
      title: missingModel ? '配置模型服务' : '查看模型服务',
      description: missingModel
        ? '助手需要先连接一个模型服务才能生成回答。'
        : '查看当前使用的模型服务，或切换成别的服务。',
      onClick: () => openSettings('model'),
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
          {actions.map((action) => (
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
