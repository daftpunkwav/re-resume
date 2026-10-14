#!/usr/bin/env bash
# Self-tests for .githooks/pre-commit. Run from the repo root.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
HOOK=.githooks/pre-commit
pass=0; fail=0
fixtures=()
fixture_dir=""
output=""

cleanup_fixture() {
  git rm -q -f --cached --ignore-unmatch -- "$1" >/dev/null 2>&1 || true
  rm -f -- "$1"
}

cleanup() {
  local file
  for file in "${fixtures[@]}"; do
    cleanup_fixture "$file"
  done
  [ -z "$output" ] || rm -f -- "$output"
  [ -z "$fixture_dir" ] || rmdir -- "$fixture_dir"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

output="$(mktemp "${TMPDIR:-/tmp}/pre-commit-test.XXXXXX")"
fixture_dir="$(mktemp -d .hook-test.XXXXXX)"

expect_fail() {
  local label="$1" needle="$2" file="$3"
  if bash "$HOOK" >"$output" 2>&1; then
    echo "FAIL  $label -> hook passed but should have blocked"; fail=$((fail+1))
  elif grep -qF "$needle" "$output"; then
    echo "ok    $label -> $(grep -F "$needle" "$output" | head -1)"; pass=$((pass+1))
  else
    echo "FAIL  $label -> blocked with unexpected message:"; sed 's/^/        /' "$output"; fail=$((fail+1))
  fi
  cleanup_fixture "$file"
}

expect_pass() {
  local label="$1" file="$2"
  if bash "$HOOK" >"$output" 2>&1; then
    echo "ok    $label -> allowed"; pass=$((pass+1))
  else
    echo "FAIL  $label -> hook blocked a valid file:"; sed 's/^/        /' "$output"; fail=$((fail+1))
  fi
  cleanup_fixture "$file"
}

# 1. trailing whitespace
file="$fixture_dir/ws.txt"
fixtures+=("$file")
printf 'ok line\nbad line   \n' > "$file"
git add -f -- "$file"
expect_fail "trailing whitespace" "trailing whitespace in $file" "$file"

# 2. CRLF. Note this does NOT exercise the hook: .gitattributes (`* text=auto
#    eol=lf`) normalises at `git add` time, so the index blob is already LF and
#    the hook's CRLF check is a backstop that cannot normally fire. The
#    invariant worth asserting is the one git actually guarantees - that no CR
#    reaches the stored blob.
file="$fixture_dir/crlf.txt"
fixtures+=("$file")
printf 'first\r\nsecond\r\n' > "$file"
git add -f -- "$file"
if git cat-file blob ":$file" | grep -q "$(printf '\r')"; then
  echo "FAIL  CRLF normalisation -> CR present in the stored blob"; fail=$((fail+1))
else
  echo "ok    CRLF normalisation -> .gitattributes stripped CR at add time"; pass=$((pass+1))
fi
cleanup_fixture "$file"

# 3. merge conflict marker
file="$fixture_dir/conflict.txt"
fixtures+=("$file")
printf 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n' > "$file"
git add -f -- "$file"
expect_fail "conflict marker" "merge conflict marker in $file" "$file"

# 4. missing final newline
file="$fixture_dir/nonl.txt"
fixtures+=("$file")
printf 'no trailing newline' > "$file"
git add -f -- "$file"
expect_fail "missing final newline" "does not end with a newline" "$file"

# 5. markdown hard line break must be ALLOWED
file="$fixture_dir/hardbreak.md"
fixtures+=("$file")
printf 'line one  \nline two\n' > "$file"
git add -f -- "$file"
expect_pass "markdown hard break" "$file"

# 6. clean file must be ALLOWED
file="$fixture_dir/clean.txt"
fixtures+=("$file")
printf 'clean content\n' > "$file"
git add -f -- "$file"
expect_pass "clean text" "$file"

# 7. A failed size read must block the commit, even when content checks pass.
file="$fixture_dir/size.txt"
fixtures+=("$file")
printf 'clean content\n' > "$file"
git add -f -- "$file"
git() {
  if [ "$1" = cat-file ] && [ "$2" = -s ] && [ "$3" = ":$size_test_file" ]; then
    return 1
  fi
  command git "$@"
}
export -f git
export size_test_file="$file"
expect_fail "blob size read failure" "cannot read staged blob size for $file" "$file"
unset -f git
unset size_test_file

echo "----"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
