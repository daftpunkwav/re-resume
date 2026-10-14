<!--
The PR title becomes the subject of the squashed merge commit:
  <type>(<scope>): <subject> — imperative, lowercase, ≤ 72 chars, no trailing period.

One PR does one thing; split unrelated changes.
-->

## What

<!-- What changes, and the observable effect. -->

## Why

<!-- The motivation. Link the issue (`Closes #123`), or state why there is none:
     trivial fixes, typos and documentation corrections may skip it. -->

## How

<!-- Decisions a reviewer would otherwise have to reverse-engineer: alternatives
     considered and rejected, boundaries touched. Delete if the diff is
     self-explanatory. -->

## Verification

<!-- What you ran, and what it showed. Not what you intended to run. -->

- [ ] The checks in [CONTRIBUTING.md](../CONTRIBUTING.md) pass
- [ ] Internal links resolve
- [ ] No credentials, tokens, or `.env` files in the diff
- [ ] Text files use LF and end with a newline
- [ ] Anything a test cannot reach was verified manually (describe below)

<!-- Manual steps and their output. Delete if empty. -->

## Compatibility impact

<!-- Breaking changes to any interface, format, or stored data: what breaks, who
     is affected, and the migration path. "None" is a valid answer — state it
     explicitly. -->

## Notes for the reviewer

<!-- Non-obvious trade-offs and open questions. Delete if empty. -->
