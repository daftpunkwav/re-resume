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
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run lint:css
```

The suite covers the domain invariants, the use cases against in-memory
repositories, the row mappers, the layout engine and the interface regions. One
test parses every import in the source tree and fails on a forbidden layer
direction, naming the file and the specifier.

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
```

Run it after touching the container shell or a plugin permission.

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
`<name>.zh.md`. Both are updated in the same change.

## Security

Report vulnerabilities by email to **daftpunk.wav@outlook.com** rather than in
a public issue. See [SECURITY.md](SECURITY.md).
