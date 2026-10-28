# Contributing

The contribution workflow — branch naming, commit format, merge policy — is
defined in [AGENTS.md](AGENTS.md). This document covers the checks that apply
to this repository.

## Current state

The repository holds a desktop application built on a single TypeScript runtime
inside a native container, plus the configuration and documents around it. The
TypeScript source is split into domain, application, infrastructure, bootstrap
and presentation layers, and the container holds window, plugin and packaging
configuration only.

## Checks

Run these before opening a pull request.

### Type and unit checks

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run lint:css
```

The suite covers the domain invariants, the use cases against in-memory
repositories, the row mappers, the layout engine and the interface regions. One
test parses every import in the source tree and fails on a forbidden layer
direction, naming the file and the specifier.

The suite runs in two projects. The unit tests run in jsdom, which is enough
for everything that does not depend on what a browser paints. The browser tests
run in a headless Chromium, which is where the stylesheet resolves the way the
application sees it — the outline shorthand and the custom properties resolve
there and nowhere else. The Chromium build is fetched once with
`pnpm exec playwright install --with-deps chromium`; the dependency install
does not fetch it, because package build scripts do not run in this repository.
On Linux the same command installs the system libraries Chromium needs as well.
Only that part elevates privileges: the browser itself is installed for the
user who runs the command, so the command is not run through `sudo`.

### End-to-end checks

```bash
pnpm run test:e2e
```

Playwright drives the real interface against the browser preview assembly
(`?preview`), which answers the same capabilities over memory instead of SQLite.
It needs no native container and no network: the preview's model provider is
scripted. The harness starts Vite on port 1445 itself; set `CI=1` to make it
start a fresh server, retry once and write an HTML report.

### Build

```bash
pnpm run build
```

The production bundle is compiled down to the oldest supported WebView. A
change that needs a newer language or Web API fails the compatibility check
rather than failing on a user's machine.

### Container

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Run these after touching the container shell, its commands or a plugin
permission. The Rust side owns only the container: the SQL plugin migration
registration, the pre-migration backup, the single SQLite connection, attachment
file storage, and PDF publication.

### Interactive preview

```bash
pnpm dev
```

Open <http://localhost:1420/?preview> for the in-memory preview of the
workbench. Add `&script=tools` (the default tool chain), `&script=plain` (a
plain text answer), `&script=slow` (a slow stream) or `&script=failure` (a
provider failure) to select the scripted model replay. Add `&providers=none` to
preview the empty state without a configured model service. The preview entry is
development-only and is compiled out of a production bundle.

This is the fastest way to check layout changes at 1280×840 and 960×640: the
viewport is the only difference between the preview and the desktop window at
those sizes.

### Release build

```bash
pnpm tauri build
```

Prerequisites: the Rust MSVC toolchain, the WebView2 runtime, and the Tauri
bundler's NSIS and WiX toolchains (downloaded on first use and cached under
`%LOCALAPPDATA%\tauri`). On Windows the command produces:

- `src-tauri/target/release/re-resume.exe`
- `src-tauri/target/release/bundle/msi/ReResume_<version>_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/ReResume_<version>_x64-setup.exe`

The version lives in three places that must stay in sync: `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. `Cargo.lock` updates
the packaged crate version from `Cargo.toml`. Release builds are unsigned; code
signing is not configured.

For a real-window smoke test, start the release executable (or `pnpm tauri dev`)
with WebView2's remote debugging enabled, then drive it with Playwright over
CDP:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
Start-Process src-tauri\target\release\re-resume.exe
```

```js
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
```

This drives the actual WebView2 DOM and produces screenshots at the physical
window size; use it rather than OS-level window capture, which can return stale
frames for WebView2.

### Line endings and whitespace

Every text blob is pinned to LF by [.gitattributes](.gitattributes), with
matching rules in [.editorconfig](.editorconfig). On Windows, set

```bash
git config core.autocrlf true
```

so the working tree matches the normalised blobs. Without it a CRLF line is
written back on every save, and any LF-only formatting check then reports every
file as unformatted.

Normalisation happens during `git add`, so a CRLF line does not reach a
committed blob through normal use. The pre-commit hook checks for it as a
backstop for paths where `.gitattributes` normalisation is disabled.

### Link integrity

The repository is read at the source level rather than through a rendered site,
so a broken relative link produces no error. Check internal links before
merging.

## Git hooks (optional)

`.githooks/pre-commit` requires only bash and git. It reads staged content
through the Git index, so an unstaged change in the working tree does not
affect the result, and checks for merge conflict markers, CRLF line endings,
trailing whitespace, a missing final newline, and files above 50 MB.

Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

The hook is a convenience, not a gate. The rules above hold whether or not it
is installed.

The hook has a self-test. It exercises the conflict-marker, trailing-whitespace,
final-newline and binary-skip checks in both directions, and asserts the
invariant `.gitattributes` actually guarantees: that no CR reaches a stored
blob.

```bash
bash .githooks/test-pre-commit.sh
```

Not covered: the size check, which would need a staged blob above 50 MB, and
the hook's own CRLF check, which cannot fire while normalisation is on.

Run it after changing the hook.

## Review and merge

`main` is covered by two branch rulesets. Direct pushes, force pushes, and
branch deletion are rejected; every change lands through a pull request, and
squash is the only permitted merge method.

- All review threads must be resolved before merge. Thread resolution is
  independent of approval.
- A push dismisses approvals granted before it, so the most recent push needs
  to be approved again.
- The branch must be up to date with `main`. GitHub can update the branch from
  the pull request page when it is behind.

External pull requests are accepted. A change proposed by a fork is not covered
by the branch rulesets of this repository and is reviewed by a maintainer
before merge.

## Documentation

User-facing documents are maintained in English with a Chinese mirror named
`<name>.zh.md`. Both are updated in the same change. The README is the
exception: it is the Chinese product introduction and links to this file for
the workflow.

## Security

Report vulnerabilities by email to **daftpunk.wav@outlook.com** rather than in
a public issue. See [SECURITY.md](SECURITY.md).
