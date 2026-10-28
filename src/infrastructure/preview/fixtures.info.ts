/**
 * @file fixtures.info
 * @description Starting values for the information library in the browser
 * preview: one custom module and entries across all nine modules, with several
 * modules holding more than one entry. They exist so the preview can show lists,
 * search results, ordering and a custom module without the user first typing
 * everything.
 *
 * Constraints:
 * - Every entry is built through the same validation the application uses, so a
 *   fixture that violates the schema fails at import time instead of rendering a
 *   state the real library cannot produce.
 * - Identifiers and timestamps are fixed: a preview session must look the same on
 *   every run and in every screenshot.
 */

import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import { validateCustomModuleDefinition } from '../../domain/info/CustomModule'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import { deriveEntryTitle } from '../../domain/info/InfoEntry'
import { validateFieldValues } from '../../domain/info/InfoFieldValue'
import type { InfoFieldValue } from '../../domain/info/InfoFieldValue'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { CustomModuleId } from '../../domain/shared/branded-id'
import {
  asCustomFieldKey,
  asCustomModuleId,
  asInfoEntryId,
} from '../../domain/shared/branded-id'
import { parseDateTime } from '../../domain/shared/DateTime'
import type { DateTime } from '../../domain/shared/DateTime'

/** One instant for every fixture row, so the list order never depends on the clock. */
const FIXTURE_TIME: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

/** Certificate module shown in the preview as the custom module. */
export const PREVIEW_CERTIFICATE_MODULE: CustomModuleDefinition = {
  id: asCustomModuleId('preview-module-certificate'),
  name: '证书',
  fields: [
    { key: asCustomFieldKey('f_0c1a2b3c'), label: '证书名称', type: 'text', required: true, maxLength: 120 },
    { key: asCustomFieldKey('f_0c1a2b3d'), label: '颁发机构', type: 'text', required: false, maxLength: 120 },
    { key: asCustomFieldKey('f_0c1a2b3e'), label: '说明', type: 'textarea', required: false, maxLength: 600 },
  ],
  sortOrder: 1,
  createdAt: FIXTURE_TIME,
  updatedAt: FIXTURE_TIME,
}

export const PREVIEW_INFO_CUSTOM_MODULES: readonly CustomModuleDefinition[] = [
  PREVIEW_CERTIFICATE_MODULE,
]

// The definition is validated where it is declared: an invalid preview library
// should fail while the fixture loads, not when the interface reads it.
validateCustomModuleDefinition(PREVIEW_CERTIFICATE_MODULE)

interface EntryFixture {
  readonly id: string
  readonly moduleKind: InfoModuleKind
  readonly customModuleId?: CustomModuleId | null
  readonly sortOrder: number
  readonly fields: Readonly<Record<string, unknown>>
}

function fixtureEntry(fixture: EntryFixture): InfoEntry {
  const customModule =
    fixture.customModuleId === undefined || fixture.customModuleId === null
      ? null
      : PREVIEW_CERTIFICATE_MODULE
  const fields: Readonly<Record<string, InfoFieldValue>> = validateFieldValues(
    fixture.moduleKind,
    customModule,
    fixture.fields,
  )
  return {
    id: asInfoEntryId(fixture.id),
    moduleKind: fixture.moduleKind,
    customModuleId: fixture.customModuleId ?? null,
    title: deriveEntryTitle(fixture.moduleKind, customModule, fields),
    fields,
    sortOrder: fixture.sortOrder,
    origin: 'user',
    sourceRunId: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

const CERTIFICATE_MODULE_ID = PREVIEW_CERTIFICATE_MODULE.id

/** Every preview entry, in the order the library reads them. */
export const PREVIEW_INFO_ENTRIES: readonly InfoEntry[] = [
  fixtureEntry({
    id: 'preview-personal-1',
    moduleKind: 'personal',
    sortOrder: 1,
    fields: {
      fullName: '林清越',
      gender: 'female',
      birthMonth: '1999-03',
      phone: '+86 138 0000 0000',
      email: 'linqingyue@example.com',
      city: '上海',
      website: 'https://qingyue.example.com',
      github: 'https://github.com/qingyue',
      wechat: 'qingyue_lin',
      notes: '可接受上海、杭州的工作机会。',
    },
  }),
  fixtureEntry({
    id: 'preview-education-1',
    moduleKind: 'education',
    sortOrder: 1,
    fields: {
      school: '复旦大学',
      degree: 'master',
      major: '计算机技术',
      startDate: '2021-09',
      endDate: 'present',
      gpaRanking: 'GPA 3.9/4.0',
      courses: '分布式系统、数据库系统实现、机器学习',
      description: '研究方向为分布式存储，参与实验室与企业的联合项目。',
    },
  }),
  fixtureEntry({
    id: 'preview-education-2',
    moduleKind: 'education',
    sortOrder: 2,
    fields: {
      school: '同济大学',
      degree: 'bachelor',
      major: '软件工程',
      startDate: '2017-09',
      endDate: '2021-06',
      gpaRanking: 'GPA 3.8/4.0，专业前 10%',
      courses: '数据结构、操作系统、数据库系统、计算机网络',
      description: '担任班级学习委员，连续三年获得校级奖学金。',
    },
  }),
  fixtureEntry({
    id: 'preview-internship-1',
    moduleKind: 'internship',
    sortOrder: 1,
    fields: {
      company: '字节跳动',
      role: '后端开发实习生',
      startDate: '2024-06',
      endDate: '2025-01',
      department: '电商中台',
      location: '上海',
      responsibilities:
        '负责订单中台结算链路的接口开发与性能优化。\n参与对账任务的调度改造，降低失败重试成本。',
      achievements: '将结算接口 P99 从 480ms 降到 210ms；补齐 30 余个核心用例的集成测试。',
      description: '转正评估为优秀。',
    },
  }),
  fixtureEntry({
    id: 'preview-internship-2',
    moduleKind: 'internship',
    sortOrder: 2,
    fields: {
      company: '某创业公司',
      role: '全栈开发实习生',
      startDate: '2023-07',
      endDate: '2023-12',
      department: '产品研发',
      location: '杭州',
      responsibilities: '独立完成商家后台的订单与库存模块，从接口到页面全部实现。',
      achievements: '上线后把人工录单的耗时从 10 分钟压缩到 1 分钟以内。',
    },
  }),
  fixtureEntry({
    id: 'preview-project-1',
    moduleKind: 'project',
    sortOrder: 1,
    fields: {
      name: '订单中台重构',
      role: '核心开发',
      startDate: '2024-09',
      endDate: 'present',
      techStack: 'TypeScript, Node.js, PostgreSQL, Redis',
      description: '把单体订单服务拆分为可独立部署的领域服务，保持写入一致性与可追溯。',
      responsibilities: '设计订单状态机与事件表，负责结算与对账两个子域的迁移。',
      achievements: '迁移期间零资损；核心链路吞吐提升 2.3 倍。',
      link: 'https://github.com/qingyue/order-platform',
    },
  }),
  fixtureEntry({
    id: 'preview-project-2',
    moduleKind: 'project',
    sortOrder: 2,
    fields: {
      name: '校园二手交易平台',
      role: '负责人',
      startDate: '2020-03',
      endDate: '2020-12',
      techStack: 'React, Express, MySQL',
      description: '面向校内学生的二手交易平台，支持发布、搜索与站内沟通。',
      responsibilities: '负责整体架构、数据库设计与前端页面实现。',
      achievements: '在毕业季峰值日活 2000+，累计成交 3000 余单。',
    },
  }),
  fixtureEntry({
    id: 'preview-skill-1',
    moduleKind: 'skill',
    sortOrder: 1,
    fields: {
      name: 'TypeScript',
      category: '编程语言',
      level: 'expert',
      notes: '熟悉类型系统与严格模式下的工程化实践。',
    },
  }),
  fixtureEntry({
    id: 'preview-skill-2',
    moduleKind: 'skill',
    sortOrder: 2,
    fields: {
      name: 'Node.js',
      category: '后端',
      level: 'proficient',
      notes: '熟悉异步模型、性能分析与服务端调试。',
    },
  }),
  fixtureEntry({
    id: 'preview-skill-3',
    moduleKind: 'skill',
    sortOrder: 3,
    fields: {
      name: 'PostgreSQL',
      category: '数据库',
      level: 'familiar',
      notes: '能设计索引与执行计划，熟悉事务隔离级别的取舍。',
    },
  }),
  fixtureEntry({
    id: 'preview-award-1',
    moduleKind: 'award',
    sortOrder: 1,
    fields: {
      name: '全国大学生数学建模竞赛二等奖',
      level: 'national',
      date: '2020-11',
      description: '负责模型建立与论文写作。',
    },
  }),
  fixtureEntry({
    id: 'preview-award-2',
    moduleKind: 'award',
    sortOrder: 2,
    fields: {
      name: '校优秀毕业生',
      level: 'school',
      date: '2021-06',
    },
  }),
  fixtureEntry({
    id: 'preview-job-intent-1',
    moduleKind: 'jobIntent',
    sortOrder: 1,
    fields: {
      targetRole: '后端开发工程师',
      city: '上海',
      salaryRange: '25-35K',
      employmentType: 'fullTime',
      availableFrom: '2026-07',
      notes: '偏好基础设施与数据密集型业务。',
    },
  }),
  fixtureEntry({
    id: 'preview-self-evaluation-1',
    moduleKind: 'selfEvaluation',
    sortOrder: 1,
    fields: {
      content:
        '三年后端开发经验，主导过订单中台的服务拆分与结算链路优化。习惯用数据验证方案，' +
        '擅长把复杂流程拆成可观测、可回滚的小步迭代；沟通上偏好先对齐目标再落方案。',
    },
  }),
  fixtureEntry({
    id: 'preview-certificate-1',
    moduleKind: 'custom',
    customModuleId: CERTIFICATE_MODULE_ID,
    sortOrder: 1,
    fields: {
      title: 'CET-6',
      f_0c1a2b3c: '大学英语六级',
      f_0c1a2b3d: '教育部考试中心',
      f_0c1a2b3e: '成绩 560 分。',
    },
  }),
  fixtureEntry({
    id: 'preview-certificate-2',
    moduleKind: 'custom',
    customModuleId: CERTIFICATE_MODULE_ID,
    sortOrder: 2,
    fields: {
      title: 'AWS Certified Developer',
      f_0c1a2b3c: 'AWS Certified Developer – Associate',
      f_0c1a2b3d: 'Amazon Web Services',
      f_0c1a2b3e: '2025 年通过，重点覆盖 Lambda、DynamoDB 与 API Gateway。',
    },
  }),
]
