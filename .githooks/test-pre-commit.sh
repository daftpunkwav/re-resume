#!/usr/bin/env bash
# Negative tests for .githooks/pre-commit. Run from the repo root.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 1
HOOK=.githooks/pre-commit
pass=0; fail=0

# Unique per run: a fixed path lets two concurrent self-tests clobber each
# other's output, and a predictable path under /tmp can be pre-created or
# symlinked by another local process before we open it.
OUT="$(mktemp)" || exit 1

# Fixtures are staged in the real index, so an interrupted run would leave them
# staged and let them ride along in a later commit. Record every fixture this
# run creates and unstage it on any exit path. Never clean with a `_t_*`
# wildcard: that would also match a real file the user already had.
fixtures=()

# release is idempotent - cleanup may call it again for a fixture a test has
# already removed.
release() {
  git rm -q --cached -- "$1" >/dev/null 2>&1 || true
  rm -f -- "$1"
}

cleanup() {
  local f
  for f in "${fixtures[@]+"${fixtures[@]}"}"; do
    release "$f"
  done
  rm -f -- "$OUT"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stage() {
  fixtures+=("$1")
  git add -f -- "$1"
}

expect_fail() {
  local label="$1" needle="$2" file="$3"
  if bash "$HOOK" >"$OUT" 2>&1; then
    echo "FAIL  $label -> hook passed but should have blocked"; fail=$((fail+1))
  elif grep -qF "$needle" "$OUT"; then
    echo "ok    $label -> $(grep -F "$needle" "$OUT" | head -1)"; pass=$((pass+1))
  else
    echo "FAIL  $label -> blocked with unexpected message:"; sed 's/^/        /' "$OUT"; fail=$((fail+1))
  fi
  release "$file"
}

expect_pass() {
  local label="$1" file="$2"
  if bash "$HOOK" >"$OUT" 2>&1; then
    echo "ok    $label -> allowed"; pass=$((pass+1))
  else
    echo "FAIL  $label -> hook blocked a valid file:"; sed 's/^/        /' "$OUT"; fail=$((fail+1))
  fi
  release "$file"
}

# 1. trailing whitespace
printf 'ok line\nbad line   \n' > _t_ws.txt
stage _t_ws.txt
expect_fail "trailing whitespace" "trailing whitespace in _t_ws.txt" _t_ws.txt

# 2. CRLF. Note this does NOT exercise the hook: .gitattributes (`* text=auto
#    eol=lf`) normalises at `git add` time, so the index blob is already LF and
#    the hook's CRLF check is a backstop that cannot normally fire. The
#    invariant worth asserting is the one git actually guarantees - that no CR
#    reaches the stored blob.
printf 'first\r\nsecond\r\n' > _t_crlf.txt
stage _t_crlf.txt
if git cat-file blob :_t_crlf.txt | grep -q "$(printf '\r')"; then
  echo "FAIL  CRLF normalisation -> CR present in the stored blob"; fail=$((fail+1))
else
  echo "ok    CRLF normalisation -> .gitattributes stripped CR at add time"; pass=$((pass+1))
fi
release _t_crlf.txt

# 3. merge conflict marker
printf 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n' > _t_conflict.txt
stage _t_conflict.txt
expect_fail "conflict marker" "merge conflict marker in _t_conflict.txt" _t_conflict.txt

# 4. missing final newline
printf 'no trailing newline' > _t_nonl.txt
stage _t_nonl.txt
expect_fail "missing final newline" "does not end with a newline" _t_nonl.txt

# 5. markdown hard line break must be ALLOWED
printf 'line one  \nline two\n' > _t_hardbreak.md
stage _t_hardbreak.md
expect_pass "markdown hard break" _t_hardbreak.md

# 6. clean file must be ALLOWED
printf 'clean content\n' > _t_clean.txt
stage _t_clean.txt
expect_pass "clean text" _t_clean.txt

# 7. binary file must be SKIPPED, not read as text. It carries trailing
#    whitespace on purpose: a hook that failed to skip it would block on the
#    whitespace check, so "allowed" only holds while the skip works.
printf 'bin\000ary content   \n' > _t_bin.bin
stage _t_bin.bin
expect_pass "binary skip" _t_bin.bin

echo "----"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
