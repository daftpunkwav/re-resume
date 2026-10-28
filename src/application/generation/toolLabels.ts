/**
 * @file toolLabels
 * @description The Chinese card label of every registered tool. The interface
 * shows these labels on the tool cards and the registry asserts that every write
 * and draft tool has one; a tool without a label would make a silent write look
 * like an unexplained action.
 *
 * Constraints:
 * - Labels are user-facing text: short, verb-led and stable. A tool rename must
 *   rename its label, which the registry guard enforces by count.
 * - Read tools also carry a label so a card is readable before its result lands.
 */

import type { ToolRisk } from '../../domain/generation/ToolRisk'

export const TOOL_LABELS: Readonly<Record<string, string>> = {
  searchInfoEntries: '检索信息库',
  getInfoEntries: '读取信息条目',
  listInfoModules: '查看信息模块',
  listResumes: '查看简历列表',
  getResume: '查看简历',
  listTemplates: '查看模板',
  readJobPosting: '读取岗位描述',
  checkLayoutOverflow: '检查排版溢出',
  analyzeJobDescription: '分析岗位描述',
  createInfoEntry: '新增信息条目',
  updateInfoEntry: '更新信息条目',
  createCustomModule: '新建自定义模块',
  createResume: '创建简历',
  updateResume: '更新简历信息',
  setSectionSelection: '选择简历条目',
  setSectionOrder: '调整章节顺序',
  setSectionDisplay: '调整章节显示',
  setTemplate: '切换模板',
  setAppearance: '调整外观',
  setPageSetup: '调整页面',
  writeResumeSummary: '撰写简历总结',
  writeEntryOverride: '改写条目文案',
  addCanvasBlock: '添加画布元素',
  moveCanvasBlock: '移动画布元素',
  exportPdf: '导出 PDF',
  undoLastChange: '撤销上一步修改',
}

/** Risks that must have a label, per the registry guard. */
export const LABELLED_RISKS: ReadonlySet<ToolRisk> = new Set(['write', 'draft'])
