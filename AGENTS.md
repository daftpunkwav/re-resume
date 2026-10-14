## Git conventions

`main` is the default branch. All changes reach it through a pull request.

### Branch naming

```
<type>/<kebab-case-description>
```

`type`: `feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `perf`

Examples: `feat/section-renderer`, `fix/page-overflow`, `docs/layout-notes`

### Commit messages

Format:

```
<type>(<scope>): <subject>

<body>
```

- `<scope>` is optional; omit the parentheses when there is none.
- `<subject>`: imperative, lowercase, no trailing period, 72 characters max.
- `<body>` is required. State what changed and why. Wrap at 72 characters.

Example:

```
fix(render): clip a block that exceeds the page height

A section with more content than the remaining space produced a block that
overlapped the footer instead of overflowing. The height calculation ignored
the block's top offset.
```

Rules:

- One commit does one thing. Split unrelated changes.
- No WIP, debug output, commented-out code, or placeholder values.
- No secrets, `.env` files, or credentials.
- Revert with `git revert`, keeping the original subject prefixed with `Revert: `.
  Revert commits are exempt from the format and subject rules above; the body
  remains required.

### Workflow

1. Open an issue first when the change is a bug, is behaviour-changing, or needs design
   discussion. Include what breaks, how to reproduce, and expected vs. actual. Trivial
   fixes, typos, and documentation corrections may skip the issue.
2. Branch from up-to-date `main` using the naming above.
3. Make the change. Add or update tests where the change is behaviour that a test can
   observe; a bug fix requires a regression test that fails before the fix and passes
   after it.
4. Open a PR to `main`. The title is the final squashed commit message. The body states
   what changed, why, how it was verified, and any compatibility impact.
5. Merge with squash. Delete the branch locally and remotely.

### Branch hygiene

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

- Rebase on `origin/main` regularly. Never use plain `--force` on a shared branch.
- Open a draft PR early when a change spans more than a few commits.

### After merge

```bash
git switch main
git pull --ff-only
git branch -d <branch>
git push origin --delete <branch>
```

End every task with a clean working tree and nothing unpushed.
