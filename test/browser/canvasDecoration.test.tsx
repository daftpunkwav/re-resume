/**
 * @file canvasDecoration.test
 * @description The WYSIWYG seam between the two renderers: an appearance change
 * resolves into the decoration record the store holds, the PDF renderer maps
 * the same document to the same accent, and the canvas actually paints it — a
 * section heading under `accentBar` carries a bar filled with the accent the
 * appearance names.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react'
import Konva from 'konva'
import { afterEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../src/presentation/app/ApplicationServicesProvider'
import { ResumePanel } from '../../src/presentation/features/resume/ResumePanel'
import { useResumeStore } from '../../src/presentation/features/resume/resumeStore'
import { pdfAccentColor } from '../../src/infrastructure/exporter/react-pdf/pdfTheme'
import { resolveTemplate } from '../../src/domain/resume/Template'
import { newResumeStudioRoot, seedResume } from '../support/resumeStudioRoot'
import '../../src/presentation/styles'

function renderPanel(root: Awaited<ReturnType<typeof newResumeStudioRoot>>['root']) {
  return render(
    <ApplicationServicesProvider createRoot={async () => root} resolveSnapshotPath={async () => 'test-hold'}>
      <div style={{ width: '900px', height: '900px' }}>
        <ResumePanel />
      </div>
    </ApplicationServicesProvider>,
  )
}

/** Every Konva shape on every stage the panel mounted, flattened. */
function stageNodes(): Konva.Shape[] {
  const shapes: Konva.Shape[] = []
  for (const stage of Konva.stages) {
    for (const layer of stage.getLayers()) {
      const collect = (node: Konva.Node): void => {
        if (node.nodeType === 'Shape') shapes.push(node as Konva.Shape)
        const children = (node as Konva.Container).getChildren?.() ?? []
        for (const child of children) collect(child)
      }
      for (const child of layer.getChildren()) collect(child)
    }
  }
  return shapes
}

afterEach(() => {
  cleanup()
})

describe('the canvas paints the decoration the PDF exports with', () => {
  it('resolves one accent for both renderers and draws the bar on the canvas', async () => {
    const studio = newResumeStudioRoot()
    await seedResume(studio, { title: '装饰简历', entries: [] })
    renderPanel(studio.root)
    await waitFor(() => expect(useResumeStore.getState().loadStatus).toBe('ready'), { timeout: 5000 })

    await act(async () => {
      await useResumeStore.getState().setAppearance({ accentColor: 'blue', headingStyle: 'accentBar' })
    })

    // The store resolved the appearance into the shared decoration record.
    const store = useResumeStore.getState()
    const resume = store.resume
    expect(resume).not.toBeNull()
    expect(store.decoration).toEqual({ accent: '#2563eb', headingStyle: 'accentBar' })
    if (resume === null) return

    // The PDF renderer maps the same document to the same accent.
    const template = resolveTemplate(resume.document.templateId)
    expect(pdfAccentColor(resume.document.appearance, template)).toBe('#2563eb')

    // And the canvas shows it: an accent-bar heading paints a shape filled
    // with exactly the colour the file would carry.
    await waitFor(() => {
      const painted = stageNodes().some((node) => node.fill() === '#2563eb')
      expect(painted).toBe(true)
    })
  })
})
