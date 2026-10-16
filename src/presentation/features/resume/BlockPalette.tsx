/**
 * @file BlockPalette
 * @description The three blocks a resume can start from: free text, a divider
 * and an experience taken from the library. It assembles the block and hands
 * it over; turning a block into a revision is the editor's job, which is what
 * keeps the history truthful about what was added.
 *
 * Constraints:
 * - Only confirmed variants are offered. Invariant 6 refuses an unconfirmed one
 *   at commit time, and offering it here would ask the user to build a block
 *   that cannot be saved.
 */

import { useCallback, useMemo, useState } from 'react'

import { Button } from '../../app/components/Button'
import { Panel } from '../../app/components/Panel'
import { SelectField } from '../../app/components/SelectField'
import { Spinner } from '../../app/components/Spinner'
import { TextField } from '../../app/components/TextField'
import { useServices } from '../../app/ApplicationServicesProvider'
import { useResource } from '../../app/useResource'
import type { Block } from '../../../domain/resume/Block'
import { DEFAULT_FLOW_LAYOUT } from '../../../domain/resume/Layout'
import type { Experience } from '../../../domain/catalog/Experience'
import { asBlockId } from '../../../domain/shared/branded-id'

export interface BlockPaletteProps {
  readonly disabled: boolean
  readonly onAddBlock: (block: Block) => void
}

interface VariantChoice {
  readonly value: string
  readonly label: string
}

export function BlockPalette({ disabled, onAddBlock }: BlockPaletteProps) {
  const { experiences, ids } = useServices()
  const loadLibrary = useCallback(() => experiences.list(), [experiences])
  const library = useResource(loadLibrary, [experiences])
  const [text, setText] = useState('')
  const [textError, setTextError] = useState<string | null>(null)
  const [chosenVariant, setChosenVariant] = useState('')

  const choices = useMemo(() => confirmedVariantChoices(library.data), [library.data])
  // A chosen variant that is no longer offered — deleted, or confirmed then
  // rolled back — would leave the control holding a value it has no option for.
  // Fall back to the first one that is still there, and keep the user's own
  // choice whenever it survived.
  const activeChoice = choices.some((choice) => choice.value === chosenVariant)
    ? chosenVariant
    : (choices[0]?.value ?? '')

  const addTextBlock = (): void => {
    if (text.trim() === '') {
      setTextError('文字内容不能为空。')
      return
    }
    onAddBlock({
      id: asBlockId(ids.next()),
      content: { type: 'text', text: text.trim() },
      layout: DEFAULT_FLOW_LAYOUT,
      textStyle: null,
    })
    setText('')
    setTextError(null)
  }

  const addDivider = (): void => {
    onAddBlock({
      id: asBlockId(ids.next()),
      content: { type: 'divider' },
      layout: DEFAULT_FLOW_LAYOUT,
      textStyle: null,
    })
  }

  const addExperienceBlock = (): void => {
    const source = library.data?.find((experience) =>
      experience.variants.some((variant) => choiceValue(experience.id, variant.id) === activeChoice),
    )
    const variant = source?.variants.find(
      (entry) => choiceValue(source.id, entry.id) === activeChoice && entry.confirmedAt !== null,
    )
    // An empty choice means the library holds no confirmed variant yet; the
    // control is disabled in that case, so reaching here means the list moved
    // under the form and the request must be dropped rather than invented.
    if (source === undefined || variant === undefined) return
    onAddBlock({
      id: asBlockId(ids.next()),
      content: {
        type: 'experience',
        experienceId: source.id,
        variantId: variant.id,
        refVersion: source.factVersion,
        claimIds: source.claims
          .filter((claim) => claim.status === 'confirmed')
          .map((claim) => claim.id),
      },
      layout: DEFAULT_FLOW_LAYOUT,
      textStyle: null,
    })
  }

  return (
    <Panel title="添加区块">
      {library.loading ? <Spinner label="正在读取经历库…" /> : null}

      <TextField
        label="文字内容"
        value={text}
        disabled={disabled}
        error={textError}
        onChange={(event) => {
          setText(event.target.value)
          setTextError(null)
        }}
      />

      <div className="resume-palette-actions">
        <Button onClick={addTextBlock} disabled={disabled}>
          添加文字区块
        </Button>
        <Button onClick={addDivider} disabled={disabled}>
          添加分隔线
        </Button>
      </div>

      <div className="resume-palette-separator" />

      <SelectField
        label="经历表述"
        disabled={disabled || choices.length === 0}
        options={choices}
        value={activeChoice}
        hint={choices.length === 0 ? '经历库里还没有已确认的表述。' : '只列出已确认的表述。'}
        onChange={(event) => setChosenVariant(event.target.value)}
      />
      <div className="resume-palette-actions">
        <Button onClick={addExperienceBlock} disabled={disabled || choices.length === 0}>
          添加经历区块
        </Button>
      </div>
    </Panel>
  )
}

function choiceValue(experienceId: string, variantId: string): string {
  return `${experienceId}::${variantId}`
}

function confirmedVariantChoices(
  experiences: readonly Experience[] | null,
): readonly VariantChoice[] {
  if (experiences === null) return []
  const choices: VariantChoice[] = []
  for (const experience of experiences) {
    for (const variant of experience.variants) {
      if (variant.confirmedAt === null) continue
      choices.push({
        value: choiceValue(experience.id, variant.id),
        label: `${experience.title} · ${variant.label}`,
      })
    }
  }
  return choices
}
