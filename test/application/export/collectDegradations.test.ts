import { describe, expect, it } from 'vitest'
import { collectDegradations } from '../../../src/application/export/collectDegradations'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import type { AbsoluteLayout, BlockLayout } from '../../../src/domain/resume/Layout'
import type { Block } from '../../../src/domain/resume/Block'
import { asAssetId, asBlockId } from '../../../src/domain/shared/branded-id'

function absolute(overrides: Partial<AbsoluteLayout> = {}): AbsoluteLayout {
  return { mode: 'absolute', x: 10, y: 20, width: 200, height: 40, zIndex: 0, rotation: 0, ...overrides }
}

function block(id: string, content: Block['content'], blockLayout: BlockLayout = DEFAULT_FLOW_LAYOUT): Block {
  return { id: asBlockId(id), content, layout: blockLayout, textStyle: null }
}

describe('collectDegradations', () => {
  it('reports nothing for a document of flow text blocks', () => {
    expect(collectDegradations([block('block-1', { type: 'text', text: '短文本。' })])).toEqual([])
  })

  it('reports an absolute text block as a table fallback', () => {
    const degradations = collectDegradations([
      block('block-1', { type: 'text', text: '短文本。' }, absolute()),
    ])

    expect(degradations).toEqual([
      { blockId: asBlockId('block-1'), reason: 'absolute-layout-unsupported', appliedFallback: 'table' },
    ])
  })

  it('reports an absolute divider as a border fallback', () => {
    const degradations = collectDegradations([block('block-1', { type: 'divider' }, absolute())])

    expect(degradations).toEqual([
      { blockId: asBlockId('block-1'), reason: 'absolute-layout-unsupported', appliedFallback: 'border' },
    ])
  })

  it('reports an absolute graphic as a flow-order fallback', () => {
    const degradations = collectDegradations([
      block('block-1', { type: 'graphic', assetId: asAssetId('asset-1') }, absolute()),
    ])

    expect(degradations).toEqual([
      { blockId: asBlockId('block-1'), reason: 'graphic-unsupported', appliedFallback: 'flow-order' },
      { blockId: asBlockId('block-1'), reason: 'absolute-layout-unsupported', appliedFallback: 'flow-order' },
    ])
  })

  it('reports a rotated block separately from its position', () => {
    const degradations = collectDegradations([
      block('block-1', { type: 'text', text: '旋转文本。' }, absolute({ rotation: 15 })),
    ])

    expect(degradations).toEqual([
      { blockId: asBlockId('block-1'), reason: 'absolute-layout-unsupported', appliedFallback: 'table' },
      { blockId: asBlockId('block-1'), reason: 'rotation-unsupported', appliedFallback: 'flow-order' },
    ])
  })

  it('reports a graphic wherever it sits', () => {
    const degradations = collectDegradations([
      block('block-1', { type: 'graphic', assetId: asAssetId('asset-1') }),
    ])

    expect(degradations).toEqual([
      { blockId: asBlockId('block-1'), reason: 'graphic-unsupported', appliedFallback: 'flow-order' },
    ])
  })

  it('lists every degraded block in document order', () => {
    const degradations = collectDegradations([
      block('block-1', { type: 'text', text: '一。' }),
      block('block-2', { type: 'text', text: '二。' }, absolute()),
      block('block-3', { type: 'divider' }),
    ])

    expect(degradations).toHaveLength(1)
    expect(degradations[0]?.blockId).toBe(asBlockId('block-2'))
  })
})
