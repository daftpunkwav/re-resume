/**
 * @file ExportResumeDialog
 * @description The export confirmation of the resume studio: it asks the export
 * capability for the plan (page count, overflows, warnings, suggested name),
 * shows what the file will and will not contain, and only then asks the saver
 * for a destination.
 *
 * Responsibilities:
 * - Prepare the plan when the dialog opens; a refusal is shown in place with a
 *   retry rather than as a failed export
 * - State the draft/frozen semantics of the export in one sentence
 * - List every warning and the overflow count before the confirm button becomes
 *   "仍然导出"
 * - Report the saved path, a cancelled dialog and a failed export as a toast;
 *   the dialog closes on those outcomes and stays open with the reason on failure
 *
 * Constraints:
 * - Read-only until the user confirms: opening the dialog only reads.
 * - The system dialog owns the destination; the interface never guesses a path.
 * - A frozen resume exports its snapshot, so the copy never changes afterwards.
 */

import { useEffect, useState } from 'react'

import type { PdfExportPlan, PdfExportWarning } from '../../../application/export/exportPdf'
import type { Resume } from '../../../domain/resume/Resume'
import { useServices } from '../../app/ApplicationServicesProvider'
import { Dialog } from '../../app/components/Dialog'
import { describeError } from '../../app/errorMessages'
import { showToast } from '../../app/stores/toastStore'
import './exportDialog.css'

/** One sentence per warning the export contract can report. */
const WARNING_TEXT: Readonly<Record<PdfExportWarning, string>> = {
  'missing-reference': '有失效的引用：导出文件中以「【缺失条目】」占位显示。',
  'text-overflow': '有内容超出页面：导出文件可能裁切，请先在画布上处理溢出。',
  'draft-exported': '当前是草稿：导出的是正在编辑的内容。',
  'missing-image': '有图片无法读取：导出文件中以灰色占位框显示。',
}

type Phase = 'planning' | 'ready' | 'exporting' | 'failed'

export interface ExportResumeDialogProps {
  readonly resume: Resume
  readonly open: boolean
  readonly onClose: () => void
}

export function ExportResumeDialog({ resume, open, onClose }: ExportResumeDialogProps) {
  const services = useServices()
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('planning')
  const [plan, setPlan] = useState<PdfExportPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void services.export.preparePdfExport({ resumeId: resume.id }).then(
      (prepared) => {
        if (cancelled) return
        setPlan(prepared)
        setPhase('ready')
      },
      (failure: unknown) => {
        if (cancelled) return
        setError(describeError(failure).message)
        setPhase('failed')
      },
    )
    return () => {
      cancelled = true
    }
  }, [attempt, open, resume.id, services])

  const retry = (): void => {
    setPhase('planning')
    setPlan(null)
    setError(null)
    setAttempt((value) => value + 1)
  }

  const confirm = (): void => {
    if (phase === 'failed') {
      retry()
      return
    }
    if (plan === null || phase !== 'ready') return
    setPhase('exporting')
    void services.export.exportPdf({ resumeId: resume.id }).then(
      (result) => {
        onClose()
        if (result.savedPath === null) showToast('info', '已取消导出，没有写入文件。')
        else showToast('success', `已导出 PDF：${result.savedPath}`)
      },
      (failure: unknown) => {
        setError(describeError(failure).message)
        setPhase('failed')
      },
    )
  }

  return (
    <Dialog
      open={open}
      title="导出 PDF"
      description={
        resume.status === 'frozen'
          ? '这份简历已定稿：导出的是定稿快照，内容不会随后续修改变化。'
          : '当前是草稿：导出的是正在编辑的内容；定稿后再导出可获得固定快照。'
      }
      confirmLabel={confirmLabel(phase, plan)}
      busy={phase === 'planning' || phase === 'exporting'}
      onConfirm={confirm}
      onClose={onClose}
    >
      {phase === 'planning' ? (
        <p className="studio-export-status" role="status">
          正在检查排版…
        </p>
      ) : null}
      {phase === 'failed' ? (
        <p className="studio-export-error" role="alert">
          {error ?? '导出没有完成，请重试。'}
        </p>
      ) : null}
      {phase !== 'failed' && plan !== null ? <ExportPlanSummary plan={plan} /> : null}
    </Dialog>
  )
}

function confirmLabel(phase: Phase, plan: PdfExportPlan | null): string {
  if (phase === 'failed') return '重试检查'
  if (plan !== null && (plan.warnings.length > 0 || plan.overflows.length > 0)) {
    return '仍然导出'
  }
  return '导出 PDF'
}

function ExportPlanSummary({ plan }: { readonly plan: PdfExportPlan }) {
  return (
    <div className="studio-export-summary">
      <dl className="studio-export-meta">
        <div>
          <dt>页数</dt>
          <dd>{plan.pageCount.toString()} 页</dd>
        </div>
        <div>
          <dt>文件名</dt>
          <dd title={plan.suggestedFileName}>{plan.suggestedFileName}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{plan.frozen ? '定稿快照' : '当前草稿'}</dd>
        </div>
      </dl>
      {plan.overflows.length > 0 ? (
        <p className="studio-export-overflow">
          排版有 {plan.overflows.length.toString()} 处溢出，导出文件可能与画布不完全一致。
        </p>
      ) : null}
      {plan.warnings.length > 0 ? (
        <div className="studio-export-warnings" role="status">
          <p className="studio-export-warnings-title">导出前请留意</p>
          <ul className="studio-export-warnings-list">
            {plan.warnings.map((warning) => (
              <li key={warning}>{WARNING_TEXT[warning]}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
