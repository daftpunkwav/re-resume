#!/usr/bin/env bash
# Negative tests for .githooks/pre-commit. Run from the repo root.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
HOOK=.githooks/pre-commit
pass=0; fail=0

expect_fail() {
  local label="$1" needle="$2" file="$3"
  if bash "$HOOK" >/tmp/hook.out 2>&1; then
    echo "FAIL  $label -> hook passed but should have blocked"; fail=$((fail+1))
  elif grep -qF "$needle" /tmp/hook.out; then
    echo "ok    $label -> $(grep -F "$needle" /tmp/hook.out | head -1)"; pass=$((pass+1))
  else
    echo "FAIL  $label -> blocked with unexpected message:"; sed 's/^/        /' /tmp/hook.out; fail=$((fail+1))
  fi
  git rm -q --cached -- "$file" >/dev/null 2>&1 || true
  rm -f "$file"
}

expect_pass() {
  local label="$1" file="$2"
  if bash "$HOOK" >/tmp/hook.out 2>&1; then
    echo "ok    $label -> allowed"; pass=$((pass+1))
  else
    echo "FAIL  $label -> hook blocked a valid file:"; sed 's/^/        /' /tmp/hook.out; fail=$((fail+1))
  fi
  git rm -q --cached -- "$file" >/dev/null 2>&1 || true
  rm -f "$file"
}

# 1. trailing whitespace
printf 'ok line\nbad line   \n' > _t_ws.txt
git add -f _t_ws.txt
expect_fail "trailing whitespace" "trailing whitespace in _t_ws.txt" _t_ws.txt

# 2. CRLF. Note this does NOT exercise the hook: .gitattributes (`* text=auto
#    eol=lf`) normalises at `git add` time, so the index blob is already LF and
#    the hook's CRLF check is a backstop that cannot normally fire. The
#    invariant worth asserting is the one git actually guarantees - that no CR
#    reaches the stored blob.
printf 'first\r\nsecond\r\n' > _t_crlf.txt
git add -f _t_crlf.txt
if git cat-file blob :_t_crlf.txt | grep -q "$(printf '\r')"; then
  echo "FAIL  CRLF normalisation -> CR present in the stored blob"; fail=$((fail+1))
else
  echo "ok    CRLF normalisation -> .gitattributes stripped CR at add time"; pass=$((pass+1))
fi
git rm -q --cached -- _t_crlf.txt >/dev/null 2>&1 || true
rm -f _t_crlf.txt

# 3. merge conflict marker
printf 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n' > _t_conflict.txt
git add -f _t_conflict.txt
expect_fail "conflict marker" "merge conflict marker in _t_conflict.txt" _t_conflict.txt

# 4. missing final newline
printf 'no trailing newline' > _t_nonl.txt
git add -f _t_nonl.txt
expect_fail "missing final newline" "does not end with a newline" _t_nonl.txt

# 5. markdown hard line break must be ALLOWED
printf 'line one  \nline two\n' > _t_hardbreak.md
git add -f _t_hardbreak.md
expect_pass "markdown hard break" _t_hardbreak.md

# 6. clean file must be ALLOWED
printf 'clean content\n' > _t_clean.txt
git add -f _t_clean.txt
expect_pass "clean text" _t_clean.txt

echo "----"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
