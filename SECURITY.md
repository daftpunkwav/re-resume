# Security Policy

## Reporting a vulnerability

Report privately by email to **daftpunk.wav@outlook.com**. Please do not open a
public issue for security reports.

Include a description of the issue, reproduction steps or a proof of concept, the
affected paths, and your assessment of severity. You will receive an
acknowledgment within 7 days and status updates while a fix is in progress.

## Supported versions

Fixes land on `main`. There are no tagged releases, so there is no backport
surface.

## Deployment model

There is no deployment. The repository holds documentation, configuration, and a
Git hook; nothing in it listens on a port, processes requests, or requires a
secret to function. The attack surface is the repository itself and the code
that external contributors contribute to it.

## Security-relevant surfaces

- **Repository contents are public.** Every file, including content in the
  history of any branch, is readable by anyone. Adding a file is therefore a
  disclosure decision and not only a code change.
- **Binary contents are omitted from Git diffs.** Git treats the formats
  declared in `.gitattributes` as binary and omits their contents from diffs.
  `.githooks/pre-commit` skips content checks for these files; its size check
  still applies.
- **External pull requests.** Fork pull requests are not covered by this
  repository's branch rulesets and run with the fork's permissions. They are
  reviewed before merge, which is the control that matters here.
- **Branch protection.** `main` rejects direct pushes, force pushes and
  deletion, and accepts only squashed merges through a pull request.

Findings outside these surfaces are equally welcome.

## Automated protection in place

- Secret scanning and secret scanning push protection: enabled at the
  repository level.
- Dependabot security updates: enabled.

Secret scanning detects credential patterns. It does not judge whether a file
contains information that should not be public; that is not automatable and
belongs in review.

## Scope

There is no running service to attack. Please do not run scanners, fuzzers, or
load tests against this repository.
