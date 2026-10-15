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

The application runs on a user's own desktop. It is installed locally, opens no
listening port, and keeps personal data in a database file inside the user's
application data directory. It reaches the network only when the user starts an
agent task, and then only to the model service endpoint configured in settings.

## Security-relevant surfaces

- **Local data at rest.** Experience records, resumes, revisions and snapshots
  live in an unencrypted SQLite file on disk. Anyone with access to the user's
  account can read them.
- **Provider credentials.** API keys are held in an encrypted store unlocked by a
  password held in memory for the session, and are never written to the
  database, to an export, or to a log. Agent runs scrub known credential values
  before persisting tool arguments and results.
- **Outbound model requests.** Starting an agent task sends the prompt, the
  conversation and the tool results to the configured endpoint. The destination
  is declared as application configuration and the container restricts outbound
  requests to the origins listed there.
- **Content security policy.** The window runs under a policy that permits no
  remote script or style origin. Inline styles are permitted because positioned
  elements require them; nothing else is relaxed.
- **Plugin permissions.** The container grants filesystem and network access per
  command and to named origins, rather than through the plugins' default sets.
- **Repository contents are public.** Every file, including content in the
  history of any branch, is readable by anyone. Adding a file is therefore a
  disclosure decision and not only a code change.
- **Binary files are opaque to Git diffs and the pre-commit hook.** The
  formats declared in `.gitattributes` as binary are treated as binary by Git,
  so Git diffs do not show their contents and `.githooks/pre-commit` skips
  them.
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
