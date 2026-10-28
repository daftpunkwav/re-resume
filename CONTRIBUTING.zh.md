# 贡献指南

贡献流程——分支命名、提交格式、合并策略——写在 [AGENTS.md](AGENTS.md)。
本文覆盖适用于本仓库的检查项。

## 当前状态

仓库是一个桌面应用：业务逻辑跑在原生容器的单一 TypeScript 运行时中，外加配套
的配置与文档。TypeScript 源码分为领域、应用、基础设施、组合根与界面五层；容器
侧只承载窗口、插件与打包配置。

## 检查项

开 PR 前请跑一遍。

### 类型与单元检查

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run lint:css
```

测试覆盖领域不变量、用例（仓储用内存实现）、行映射器、排版引擎与界面区域。其中
一个用例会解析源码里的每一条 import，出现被禁止的层级依赖时会点名文件与
specifier。

测试套件分两个项目跑。单元测试跑在 jsdom 里，凡是不依赖"浏览器实际画出来什么"
的断言都够用。浏览器测试跑在无头 Chromium 里——样式表只有在浏览器里才会像应用看到
的那样解析：outline 简写与自定义属性只在那里解析。Chromium 构建产物用
`pnpm exec playwright install --with-deps chromium` 拉取一次；依赖安装不会拉取它，
因为本仓库不执行依赖包的构建脚本。Linux 上同一条命令会一并安装 Chromium 所需的
系统库。只有这一步会提权：浏览器本体仍装在执行命令的用户下，所以整条命令不要用
`sudo` 跑。

### 端到端检查

```bash
pnpm run test:e2e
```

Playwright 针对浏览器预览装配（`?preview`）驱动真实界面：预览用内存实现提供与
桌面窗口相同的能力，不依赖原生容器，也不需要网络（预览的模型服务是脚本化的）。
测试框架会自行在 1445 端口启动 Vite；设置 `CI=1` 时改为每次新起服务、失败重试一次
并输出 HTML 报告。

### 构建

```bash
pnpm run build
```

生产产物会编译到受支持的最旧 WebView 基线。用到更新语法或 API 的改动会在兼容
检查阶段失败，而不是在用户机器上失败。

### 容器

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

改动容器壳、其命令或插件权限后请执行。Rust 侧只承载容器：SQL 插件的迁移注册、
迁移前备份、单连接 SQLite、附件文件存储与 PDF 发布。

### 交互式预览

```bash
pnpm dev
```

打开 <http://localhost:1420/?preview> 使用内存版预览工作台。追加
`&script=tools`（默认工具链）、`&script=plain`（纯文本回答）、`&script=slow`
（慢速流式）或 `&script=failure`（模型失败）选择脚本化模型的重放。追加
`&providers=none` 预览未配置模型服务的空态。预览入口只在开发模式存在，生产构建不会
包含它。

这是检查 1280×840 与 960×640 布局最快的方式：在该尺寸下，预览与桌面窗口的差别只有
视口本身。

### 发布构建

```bash
pnpm tauri build
```

前置条件：Rust MSVC 工具链、WebView2 运行时，以及 Tauri 打包器使用的 NSIS 与 WiX
工具链（首次使用时下载，缓存在 `%LOCALAPPDATA%\tauri`）。Windows 上会产出：

- `src-tauri/target/release/re-resume.exe`
- `src-tauri/target/release/bundle/msi/ReResume_<version>_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/ReResume_<version>_x64-setup.exe`

版本号写在三处，必须保持一致：`package.json`、`src-tauri/Cargo.toml` 与
`src-tauri/tauri.conf.json`。`Cargo.lock` 会根据 `Cargo.toml` 更新打包 crate 的
版本。发布构建未配置代码签名。

真实窗口冒烟：用 WebView2 的远程调试参数启动发布可执行文件（或 `pnpm tauri dev`），
再用 Playwright 通过 CDP 驱动：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
Start-Process src-tauri\target\release\re-resume.exe
```

```js
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
```

这样驱动的是 WebView2 的真实 DOM，并按窗口物理尺寸截图。不要用操作系统级窗口截图，
它对 WebView2 可能返回过期帧。

### 行尾与空白

所有文本 blob 由 [.gitattributes](.gitattributes) 钉死为 LF，配套规则在
[.editorconfig](.editorconfig)。Windows 上请设置

```bash
git config core.autocrlf true
```

使工作区与规范化后的 blob 一致。否则 CRLF 行会在每次保存时被写回，任何只认
LF 的格式检查都会把所有文件报成未格式化。

规范化发生在 `git add` 阶段，因此正常使用路径下 CRLF 不会进入已提交的
blob。pre-commit 钩子检查这一项，作为 `.gitattributes` 规范化在某条路径上被
关闭时的兜底。

### 链接可达性

本仓库在源码层面被阅读，而非通过渲染站点，因此相对链接失效不会产生任何
报错。合并前请自查内链。

## Git 钩子（可选）

`.githooks/pre-commit` 除 bash 与 git 外无任何依赖。它通过 Git 索引读取暂存
内容，工作区中未暂存的改动不会影响结果；检查项为合并冲突标记、CRLF 行尾、
行尾空白、缺少末尾换行，以及超过 50 MB 的文件。

每个克隆启用一次：

```bash
git config core.hooksPath .githooks
```

钩子是便利工具，不是门禁。装不装，上面的规则都一样成立。

钩子自带自测，覆盖合并冲突标记、行尾空白、末尾换行与二进制跳过四项检查的正反
两个方向，并断言 `.gitattributes` 真正保证的那条不变式：CR 不会进入已存储的
blob。

```bash
bash .githooks/test-pre-commit.sh
```

未覆盖：体积检查（需要一个超过 50 MB 的暂存 blob），以及钩子自身的 CRLF 检查
（规范化开启时它不可能触发）。

改动钩子后请运行。

## 评审与合并

`main` 由两条分支规则集覆盖。直接推送、强推、删除分支均被拒绝；所有变更
一律通过 pull request 落地，且 squash 是唯一允许的合并方式。

- 所有评审 thread 都解决后才能合并。thread 解决与批准相互独立。
- 推送会撤销此前的批准，因此末次推送需要重新获得批准。
- 分支必须已基于最新 `main`。落后时可在 PR 页面用 GitHub 更新分支。

接受外部 PR。fork 发起的变更不受本仓库分支规则集覆盖，合并前由维护者评审。

## 文档

面向用户的文档以英文维护，并提供中文镜像 `<name>.zh.md`，两者在同一次改动中
同步更新。README 是例外：它是中文产品介绍，工作流部分链接到本文。

## 安全

漏洞请邮件报告至 **daftpunk.wav@outlook.com**，不要提公开 issue。
详见 [SECURITY.zh.md](SECURITY.zh.md)。
