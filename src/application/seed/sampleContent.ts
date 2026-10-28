/**
 * @file sampleContent
 * @description The fictional but plausible content of the sample library: one
 * candidate's information, a custom module, two resumes and one conversation.
 *
 * Constraints:
 * - Names, companies and figures are clearly fictional; the sample is a tour of
 *   the application, not a resume the user should mistake for their own.
 * - This module is pure data: no identifiers, no timestamps. The seed use case
 *   allocates those through the ordinary use cases.
 */

import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { CustomFieldType } from '../../domain/info/CustomModule'

export interface SampleEntry {
  readonly moduleKind: Exclude<InfoModuleKind, 'custom'>
  readonly fields: Readonly<Record<string, string>>
}

export interface SampleCustomField {
  readonly label: string
  readonly type: CustomFieldType
  readonly required: boolean
  readonly maxLength: number
}

export interface SampleCustomEntry {
  readonly title: string
  /** Values keyed by the field label; the seed maps them onto generated keys. */
  readonly values: Readonly<Record<string, string>>
}

export const SAMPLE_CUSTOM_MODULE = {
  name: '开源贡献',
  fields: [
    { label: '项目', type: 'text', required: true, maxLength: 80 },
    { label: '贡献', type: 'textarea', required: false, maxLength: 600 },
  ] as const satisfies readonly SampleCustomField[],
}

export const SAMPLE_CUSTOM_ENTRIES: readonly SampleCustomEntry[] = [
  {
    title: '组件库样式令牌',
    values: {
      项目: 'open-design-tokens',
      贡献: '整理了暗色主题的语义色令牌，并为对比度补充浏览器测试。',
    },
  },
  {
    title: '文档站搜索',
    values: {
      项目: 'docs-search',
      贡献: '接入了本地全文索引，首屏搜索从 400ms 降到 90ms。',
    },
  },
]

export const SAMPLE_ENTRIES: readonly SampleEntry[] = [
  {
    moduleKind: 'personal',
    fields: {
      fullName: '林知远',
      gender: 'male',
      birthMonth: '2001-08',
      phone: '13800000000',
      email: 'zhiyuan.lin@example.com',
      city: '杭州',
      website: 'https://example.com/zhiyuan',
      github: 'https://github.com/zhiyuan-example',
      wechat: 'zhiyuan_example',
      notes: '可实习 6 个月以上，2026 年 6 月毕业。',
    },
  },
  {
    moduleKind: 'education',
    fields: {
      school: '江城大学',
      degree: 'bachelor',
      major: '软件工程',
      startDate: '2022-09',
      endDate: '2026-06',
      gpaRanking: '3.8 / 4.0，专业前 10%',
      courses: '数据结构、操作系统、编译原理、计算机网络、人机交互',
      description: '校 ACM 集训队成员，参与校际程序设计竞赛组织。',
    },
  },
  {
    moduleKind: 'education',
    fields: {
      school: '江城大学',
      degree: 'master',
      major: '计算机技术（拟录取）',
      startDate: '2026-09',
      endDate: 'present',
      description: '保研方向为前端工程与可视化。',
    },
  },
  {
    moduleKind: 'internship',
    fields: {
      company: '远山科技',
      role: '前端开发实习生',
      startDate: '2025-06',
      endDate: '2025-09',
      department: '企业应用部',
      location: '杭州',
      responsibilities:
        '参与内部数据看板重构，负责图表与筛选器模块；\n把重复的表单逻辑抽成配置驱动组件。',
      achievements:
        '看板首屏渲染从 2.4s 降到 1.1s；\n表单模块被两个业务线复用，减少了约 30% 的重复代码。',
    },
  },
  {
    moduleKind: 'internship',
    fields: {
      company: '微光工作室',
      role: '全栈实习生',
      startDate: '2024-07',
      endDate: '2024-09',
      department: '产品研发',
      location: '远程',
      responsibilities:
        '独立完成用户反馈后台的查询与导出；\n维护部署脚本并补齐回滚步骤。',
      achievements: '反馈处理时间从周级缩短到天级。',
    },
  },
  {
    moduleKind: 'internship',
    fields: {
      company: '江城大学计算中心',
      role: '学生助理',
      startDate: '2023-03',
      endDate: '2024-06',
      department: '教学支持',
      location: '杭州',
      responsibilities: '维护实验课环境，编写课程网站的示例代码与答疑文档。',
    },
  },
  {
    moduleKind: 'project',
    fields: {
      name: '排版实验室',
      role: '独立开发者',
      startDate: '2025-02',
      endDate: 'present',
      techStack: 'TypeScript, React, Canvas, Fontkit',
      description:
        '面向中文简历的排版实验工具：把章节排版规则抽象成可测试的纯函数，用真实中文字体测量断行。',
      responsibilities: '设计文档模型与分页算法；实现可撤销的编辑历史；补齐黄金渲染测试。',
      achievements: '单页排版从 24ms 优化到 6ms；测试覆盖全部六个模板。',
      link: 'https://github.com/zhiyuan-example/layout-lab',
    },
  },
  {
    moduleKind: 'project',
    fields: {
      name: '小程序点单系统',
      role: '前端负责人',
      startDate: '2024-10',
      endDate: '2025-01',
      techStack: 'Taro, TypeScript, Node.js',
      description: '为校园咖啡店做的点单与取餐编号系统，支持多人同时下单。',
      responsibilities: '负责菜单与订单页；设计离线缓存，弱网时也能加购。',
      achievements: '高峰期每秒 30 单无重复编号；上线后线下排队时间减半。',
    },
  },
  {
    moduleKind: 'project',
    fields: {
      name: '课程知识图谱',
      role: '数据与前端',
      startDate: '2024-03',
      endDate: '2024-06',
      techStack: 'Python, D3.js, SQLite',
      description: '把培养方案中的课程依赖关系可视化成可探索的图谱。',
      responsibilities: '清洗课程数据并抽取先修关系；实现缩放与筛选交互。',
      achievements: '被用于新生选课指导页面。',
    },
  },
  {
    moduleKind: 'project',
    fields: {
      name: '校园二手书交易',
      role: '全栈开发者',
      startDate: '2023-09',
      endDate: '2023-12',
      techStack: 'Vue, Express, PostgreSQL',
      description: '毕业季二手书发布与检索的小型平台。',
      responsibilities: '实现检索、图片上传与交易状态流转。',
    },
  },
  {
    moduleKind: 'project',
    fields: {
      name: '命令行番茄钟',
      role: '独立开发者',
      startDate: '2023-05',
      endDate: '2023-06',
      techStack: 'Rust',
      description: '终端里的番茄钟与统计工具，支持按项目记录专注时间。',
      achievements: '开源后收到 40 余个 star。',
    },
  },
  {
    moduleKind: 'skill',
    fields: { name: 'TypeScript', category: '语言', level: 'proficient', notes: '偏好严格类型与不可变数据。' },
  },
  {
    moduleKind: 'skill',
    fields: { name: 'React', category: '框架', level: 'proficient', notes: '熟悉并发渲染与性能剖析。' },
  },
  {
    moduleKind: 'skill',
    fields: { name: 'CSS / 设计系统', category: '样式', level: 'familiar', notes: '能读懂设计稿并落地为令牌与组件。' },
  },
  {
    moduleKind: 'skill',
    fields: { name: 'Node.js', category: '运行时', level: 'familiar', notes: '写过构建脚本与小规模服务。' },
  },
  {
    moduleKind: 'skill',
    fields: { name: 'SQLite', category: '数据', level: 'familiar', notes: '写过多表查询与迁移脚本。' },
  },
  {
    moduleKind: 'skill',
    fields: { name: '英语', category: '语言', level: 'proficient', notes: 'CET-6，能阅读英文技术文档。' },
  },
  {
    moduleKind: 'award',
    fields: {
      name: '全国大学生程序设计竞赛 省赛一等奖',
      level: 'provincial',
      date: '2024-11',
      description: '团队三人，负责图论与数据结构题目。',
    },
  },
  {
    moduleKind: 'award',
    fields: {
      name: '校级优秀学生奖学金',
      level: 'school',
      date: '2025-06',
      description: '两次获得，综合测评前 10%。',
    },
  },
  {
    moduleKind: 'jobIntent',
    fields: {
      targetRole: '前端开发实习生',
      city: '杭州',
      salaryRange: '200-300 元/天',
      employmentType: 'internship',
      availableFrom: '2026-01',
      notes: '希望参与真实产品的前端开发，长期实习优先。',
    },
  },
  {
    moduleKind: 'selfEvaluation',
    fields: {
      content:
        '喜欢把复杂交互拆成可验证的小块，也愿意补测试与文档。\n做过完整的产品从设计稿到上线，能在不确定的需求里主动确认边界。',
    },
  },
]

export interface SampleResumePlan {
  readonly title: string
  readonly targetJob: { readonly title: string; readonly company: string }
  /** Built-in modules and how many leading entries of each to select. */
  readonly selection: Readonly<Record<string, number>>
  readonly customCount: number
}

export const SAMPLE_DRAFT_RESUME: SampleResumePlan = {
  title: '前端实习 · 林知远',
  targetJob: { title: '前端开发实习生', company: '远山科技' },
  selection: {
    personal: 1,
    education: 1,
    internship: 2,
    project: 3,
    skill: 4,
    award: 1,
    jobIntent: 1,
    selfEvaluation: 1,
  },
  customCount: 2,
}

export const SAMPLE_FROZEN_RESUME: SampleResumePlan = {
  title: '前端实习 · 林知远（定稿）',
  targetJob: { title: '前端开发实习生', company: '云帆互动' },
  selection: {
    personal: 1,
    education: 2,
    internship: 3,
    project: 5,
    skill: 6,
    award: 2,
    jobIntent: 1,
    selfEvaluation: 1,
  },
  customCount: 2,
}

export const SAMPLE_CONVERSATION_TITLE = '示例：前端实习申请'

export interface SampleMessage {
  readonly role: 'user' | 'assistant'
  readonly markdown: string
}

export const SAMPLE_CONVERSATION_MESSAGES: readonly SampleMessage[] = [
  {
    role: 'user',
    markdown:
      '我准备投前端开发实习。目标岗位是「前端开发实习生」，希望突出排版和性能优化的经验。先帮我看看信息库里的内容够不够。',
  },
  {
    role: 'assistant',
    markdown:
      '你的信息库已经很完整了：两段实习、五个项目、六项技能，还有获奖和求职意向。\n\n建议优先展示：\n\n1. **排版实验室**：直接对应前端工程与性能优化，可以把「单页排版 24ms → 6ms」放在最前；\n2. **远山科技**：看板首屏从 2.4s 降到 1.1s，是能说明结果的一段；\n3. **开源贡献**：证明你能在别人的代码里工作。\n\n需要我把这些条目组织成一份针对该岗位的简历吗？',
  },
  {
    role: 'user',
    markdown: '好，就按这个顺序组织一份草稿。',
  },
]
