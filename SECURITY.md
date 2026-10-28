# Security Policy

## Reporting a vulnerability

Report privately by email to **daftpunk.wav@outlook.com**. Please do not open a
public issue for security reports.

Include a description of the issue, reproduction steps or a proof of concept, the
affected paths, and your assessment of severity. You will receive an
acknowledgment within 7 days and status updates while a fix is in progress.

## Supported versions

The supported release line is **1.0.x** on `main`. Fixes land on `main`; there is
no older release line to backport to.

## Deployment model

The application runs on a user's own desktop. It is installed locally, opens no
listening port, and keeps personal data in the application data directory. It
reaches the network only when the user starts an agent task or tests a model
provider connection, and then only to the model endpoint configured in settings.

## Security-relevant surfaces

- **Local data at rest.** Information entries, resumes, revisions, snapshots,
  conversations and exported backups live in an unencrypted SQLite database and
  JSON file on disk. Attached images and job-description screenshots are copied
  into an `attachments/` directory beside the database as ordinary files. Exported
  PDFs are written wherever the user points the save dialog. Anyone with access
  to the user's account can read all of it.
- **Provider credentials.** API keys are held in an encrypted Stronghold snapshot
  unlocked by a password held in memory for the session. The key-derivation salt
  sits next to the snapshot; losing it makes the stored credentials unreadable.
  Keys are never written to the database, to an export, or to a log. Agent runs
  scrub known credential values before persisting tool arguments and results.
- **Outbound model requests.** Starting an agent task sends the prompt, the
  relevant conversation and the tool results to the configured endpoint. The
  destination is declared as application configuration and the container's HTTP
  scope restricts requests to the origins listed in
  `src-tauri/capabilities/default.json5` (`api.anthropic.com` and
  `api.openai.com` today); redirects are checked against the same scope. Pointing
  the application at a self-hosted endpoint requires adding that origin to the
  capability file and shipping a new build.
- **Content security policy.** The production window runs under a policy that
  permits no remote script, style, font or connection origin. `wasm-unsafe-eval`
  is allowed because the PDF layout engine instantiates a WebAssembly module
  shipped inside the bundle; inline styles are allowed because React and Konva
  position elements through the style attribute; `data:` and `blob:` images cover
  canvas output. `connect-src` names only the Tauri IPC endpoints. The relaxed
  development policy exists so the Vite dev server can serve the window and is
  not used by a production build. The preview/demo assembly is compiled out of
  the production bundle.
- **Plugin permissions.** The container grants the webview a minimal capability
  set: the Tauri core path resolver, SQLite read/write, outbound HTTP for the two
  named origins, the save dialog, and seven individual Stronghold commands. No
  filesystem command is granted; export publishing and attachment reads/writes
  are application commands that validate their arguments on the native side.
  Message/confirm dialogs, shell, clipboard, global-shortcut and updater plugins
  are not registered.
- **Attachments and screenshots.** An image is sent to the model only as part of
  a turn the user sends; it is not uploaded anywhere else. Local attachment files
  are otherwise readable by anyone with access to the account.
- **Repository contents are public.** Every file, including content in the
  history of any branch, is readable by anyone. Adding a file is therefore a
  disclosure decision and not only a code change.
- **Binary files are opaque to Git diffs and the pre-commit hook.** The formats
  declared in `.gitattributes` as binary are treated as binary by Git, so Git
  diffs do not show their contents and `.githooks/pre-commit` skips them.
- **External pull requests.** Fork pull requests are not covered by this
  repository's branch rulesets and run with the fork's permissions. They are
  reviewed before merge, which is the control that matters here.
- **Branch protection.** `main` rejects direct pushes, force pushes and deletion,
  and accepts only squashed merges through a pull request.

Findings outside these surfaces are equally welcome.

## Dependency review

- Secret scanning and secret scanning push protection: enabled at the repository
  level.
- Dependabot security updates: enabled.
- Just-in-time dependency audits are part of the release checklist: `pnpm audit`
  for the JavaScript tree, and `cargo deny check advisories` for the Rust shell.
  The JavaScript findings are in development-only transitive packages (the test
  runner and the stylesheet linter); the Rust advisories are reviewed and either
  patched, accepted with a reason in the pull request, or tracked before the
  release is published.

Secret scanning detects credential patterns. It does not judge whether a file
contains information that should not be public; that is not automatable and
belongs in review.

## Scope

There is no running service to attack. Please do not run scanners, fuzzers, or
load tests against this repository.
