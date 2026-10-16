/**
 * @file ProfileForm
 * @description Editor for the single profile row: the identity fields a resume
 * header shows, plus the link list.
 *
 * Responsibilities:
 * - Load the current profile and render its loading and failure states
 * - Edit the identity fields and the repeatable link list
 * - Save through UpdateProfile and reload, so the version shown is the stored one
 *
 * Constraints:
 * - The draft is remounted from the loaded profile when its version changes,
 *   which is what makes the reload after a save visible rather than silent.
 * - A blank name is reported here, not at export time. UpdateProfile accepts an
 *   empty display name so a seeded row can be cleared, and a resume that copied
 *   a nameless profile has nothing to export.
 */

import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useServices } from '../../app/ApplicationServicesProvider'
import { useOperation } from '../../app/useOperation'
import { useResource } from '../../app/useResource'
import type { ReadableError } from '../../app/errorMessages'
import { Button } from '../../app/components/Button'
import { Notice } from '../../app/components/Notice'
import { Panel } from '../../app/components/Panel'
import { Spinner } from '../../app/components/Spinner'
import { TextField } from '../../app/components/TextField'
import type { ProfileSettings } from '../../../bootstrap/compositionRoot'
import type { Profile } from '../../../domain/catalog/Profile'
import type { UpdateProfileCommand } from '../../../application/profile/UpdateProfile'

interface ProfileDraftLink {
  /** Client-only, so a row keeps its inputs across edits elsewhere in the
   *  list. Stripped in toCommand: the stored profile has no such field. */
  readonly id: string
  readonly label: string
  readonly url: string
}

interface ProfileDraft {
  readonly displayName: string
  readonly email: string
  readonly phone: string
  readonly links: readonly ProfileDraftLink[]
}

let linkSequence = 0

function nextLinkId(): string {
  linkSequence += 1
  return `draft-link-${linkSequence}`
}

/** Every text input is a string; the stored profile carries null for the two
 *  optional fields, and an empty string means the same thing to UpdateProfile. */
function toDraft(profile: Profile): ProfileDraft {
  return {
    displayName: profile.displayName,
    email: profile.email ?? '',
    phone: profile.phone ?? '',
    links: profile.links.map((link) => ({ id: nextLinkId(), label: link.label, url: link.url })),
  }
}

function toCommand(draft: ProfileDraft): UpdateProfileCommand {
  return {
    displayName: draft.displayName,
    email: draft.email,
    phone: draft.phone,
    links: draft.links.map((link) => ({ label: link.label, url: link.url })),
  }
}

export function ProfileForm() {
  const { profile } = useServices()
  const loaded = useResource(() => profile.get(), [profile])

  return (
    <Panel title="个人资料">
      <div className="stack">
        {loaded.error === null ? null : (
          <OperationFailure
            title="无法读取个人资料"
            failure={loaded.error}
            actions={
              <Button size="small" onClick={() => void loaded.reload()}>
                重试
              </Button>
            }
          />
        )}
        {loaded.data === null ? (
          <Spinner label="正在读取个人资料…" />
        ) : (
          <ProfileFields
            // Every update bumps version, so a changed version is what tells the
            // form the stored profile moved on and the draft has to start over.
            key={loaded.data.version}
            profile={loaded.data}
            service={profile}
            onSaved={loaded.reload}
          />
        )}
      </div>
    </Panel>
  )
}

/**
 * Split from ProfileForm so the draft is non-null by construction: the parent
 * renders this only once a profile has arrived, and the key makes a remount the
 * thing that re-seeds the draft after a save brings back a new profile.
 */
function ProfileFields({
  profile,
  service,
  onSaved,
}: {
  readonly profile: Profile
  readonly service: ProfileSettings
  readonly onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState(() => toDraft(profile))

  const save = useOperation(
    useCallback(async () => {
      const result = await service.update(toCommand(draft))
      if (!result.ok) throw result.error
      await onSaved()
    }, [draft, onSaved, service]),
  )

  const replaceDraft = (next: ProfileDraft): void => {
    save.clearError()
    setDraft(next)
  }

  const addLink = (): void => {
    replaceDraft({ ...draft, links: [...draft.links, { id: nextLinkId(), label: '', url: '' }] })
  }

  const removeLink = (index: number): void => {
    replaceDraft({ ...draft, links: draft.links.filter((_, at) => at !== index) })
  }

  const nameIsBlank = draft.displayName.trim().length === 0

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        void save.run()
      }}
    >
      <div className="form-grid">
        <TextField
          label="姓名"
          value={draft.displayName}
          disabled={save.busy}
          autoComplete="off"
          onChange={(event) => replaceDraft({ ...draft, displayName: event.target.value })}
        />
        <TextField
          label="邮箱"
          type="email"
          value={draft.email}
          disabled={save.busy}
          autoComplete="off"
          onChange={(event) => replaceDraft({ ...draft, email: event.target.value })}
        />
        <TextField
          label="电话"
          type="tel"
          value={draft.phone}
          disabled={save.busy}
          autoComplete="off"
          onChange={(event) => replaceDraft({ ...draft, phone: event.target.value })}
        />
      </div>

      {nameIsBlank ? (
        <Notice tone="warning" title="姓名还是空的">
          <p>简历的个人资料区块会复制这里的姓名；从空姓名复制出来的简历没有可导出的内容。</p>
        </Notice>
      ) : null}

      <div className="stack">
        <p className="field-label">链接</p>
        {draft.links.length === 0 ? (
          <p className="settings-meta">还没有链接。</p>
        ) : (
          <ul className="stack">
            {draft.links.map((link, index) => (
              <li className="settings-link-row" key={link.id}>
                <TextField
                  label="链接名称"
                  value={link.label}
                  disabled={save.busy}
                  autoComplete="off"
                  onChange={(event) => {
                    const links = [...draft.links]
                    links[index] = { ...link, label: event.target.value }
                    replaceDraft({ ...draft, links })
                  }}
                />
                <TextField
                  label="链接地址"
                  value={link.url}
                  disabled={save.busy}
                  autoComplete="off"
                  onChange={(event) => {
                    const links = [...draft.links]
                    links[index] = { ...link, url: event.target.value }
                    replaceDraft({ ...draft, links })
                  }}
                />
                <Button
                  variant="ghost"
                  size="small"
                  iconOnly
                  icon="trash"
                  aria-label={`删除第 ${index + 1} 条链接`}
                  disabled={save.busy}
                  onClick={() => removeLink(index)}
                />
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button icon="plus" disabled={save.busy} onClick={addLink}>
            添加链接
          </Button>
        </div>
      </div>

      <dl className="definition-list settings-meta">
        <dt>版本</dt>
        <dd>{profile.version}</dd>
      </dl>
      <p className="settings-meta">
        简历的个人资料区块记录的是复制当时的版本，两者不一致时界面会提示重新同步。
      </p>

      {save.error === null ? null : <OperationFailure title="保存失败" failure={save.error} />}

      <div className="settings-actions">
        <Button type="submit" variant="primary" disabled={save.busy}>
          保存
        </Button>
      </div>
    </form>
  )
}

/**
 * Duplicated in ProviderForm rather than shared: both forms are siblings under
 * SettingsView, so a shared piece would have to live in one of the two or come
 * back out of SettingsView, which they both already import from.
 */
function OperationFailure({
  title,
  failure,
  actions,
}: {
  readonly title: string
  readonly failure: ReadableError
  readonly actions?: ReactNode
}) {
  return (
    <Notice tone="danger" title={title} actions={actions}>
      <p>{failure.message}</p>
      {failure.blockers.length === 0 ? null : (
        <ul className="settings-blockers">
          {failure.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </Notice>
  )
}
