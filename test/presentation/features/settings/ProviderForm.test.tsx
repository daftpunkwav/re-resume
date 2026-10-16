/**
 * @file ProviderForm.test
 * @description Behaviour of the 模型服务 tab: what reaches the provider
 * settings store, what the confirming dialog stops, and what the interface
 * says about the vault password and about an agent run.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderForm } from '../../../../src/presentation/features/settings/ProviderForm'
import { useProviderSettings } from '../../../../src/presentation/app/providerSettingsStore'
import type { ProviderSettings } from '../../../../src/presentation/app/providerSettingsStore'

const SAVED: ProviderSettings = {
  kind: 'openai-compatible',
  id: 'openai',
  modelId: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyRef: 'openai.apiKey',
}

beforeEach(() => {
  window.localStorage.clear()
  useProviderSettings.setState({ settings: null, vaultPassword: '' })
})

describe('ProviderForm', () => {
  it('writes the descriptor through the store and keeps it in local storage', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ProviderForm />)

    await user.selectOptions(screen.getByLabelText('服务类型'), 'anthropic')
    await user.type(screen.getByLabelText('服务标识'), 'anthropic-main')
    await user.type(screen.getByLabelText('模型标识'), 'claude-sonnet-4-5')
    await user.type(screen.getByLabelText('接口地址'), 'https://api.anthropic.com')
    await user.type(screen.getByLabelText('凭据引用键'), 'anthropic.apiKey')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await vi.waitFor(() => {
      expect(useProviderSettings.getState().settings).toEqual({
        kind: 'anthropic',
        id: 'anthropic-main',
        modelId: 'claude-sonnet-4-5',
        baseUrl: 'https://api.anthropic.com',
        apiKeyRef: 'anthropic.apiKey',
      })
    })
    expect(window.localStorage.getItem('reresume.provider')).not.toBeNull()
  })

  it('cannot save a descriptor with an empty field', () => {
    render(<ProviderForm />)

    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('asks before clearing, and clears nothing until the dialog is confirmed', async () => {
    useProviderSettings.getState().saveSettings(SAVED)
    const user = userEvent.setup({ delay: null })
    render(<ProviderForm />)

    await user.click(screen.getByRole('button', { name: '清除模型服务配置' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/凭据库里的密钥不受影响/)).toBeInTheDocument()
    expect(useProviderSettings.getState().settings).toEqual(SAVED)

    await user.click(within(dialog).getByRole('button', { name: '清除' }))

    await vi.waitFor(() => {
      expect(useProviderSettings.getState().settings).toBeNull()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the descriptor when the dialog is dismissed', async () => {
    useProviderSettings.getState().saveSettings(SAVED)
    const user = userEvent.setup({ delay: null })
    render(<ProviderForm />)

    await user.click(screen.getByRole('button', { name: '清除模型服务配置' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useProviderSettings.getState().settings).toEqual(SAVED)
  })

  it('states that the vault password is held for the session only', () => {
    render(<ProviderForm />)

    const hint = screen.getByText(/只保存在内存里/)
    expect(hint).toHaveTextContent('只保存在内存里，本次会话内有效，不会写入磁盘。')
    expect(hint).toHaveTextContent('关闭应用即失效')
  })

  it('puts the unlocked password in memory and not in storage', async () => {
    const user = userEvent.setup({ delay: null })
    render(<ProviderForm />)

    await user.type(screen.getByLabelText('凭据库密码'), 'vault-passphrase')
    await user.click(screen.getByRole('button', { name: '解锁凭据库' }))

    await vi.waitFor(() => {
      expect(useProviderSettings.getState().vaultPassword).toBe('vault-passphrase')
    })
    expect(window.localStorage.getItem('reresume.provider')).toBeNull()
    // Nothing has opened the vault yet, so the form must not claim it did.
    expect(await screen.findByText('凭据库密码已保存在本次会话')).toBeInTheDocument()
  })

  it('names what an agent run sends and where it goes', () => {
    render(<ProviderForm />)

    const notice = screen.getByText(/系统提示词、你的指令、模型的回复和工具执行结果/)
    expect(notice).toHaveTextContent('发送到你上面填写的接口地址')
    expect(notice).toHaveTextContent('代码里没有别的出站请求')
  })
})
