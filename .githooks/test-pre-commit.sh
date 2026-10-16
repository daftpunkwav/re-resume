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

# The hook reads the git index and nothing else, so the self-test hands it one
# of its own. Anything the user has staged is invisible to it, and the fixtures
# this run adds leave the real index exactly as it was.
GIT_INDEX_FILE="$(mktemp -d)/index"
export GIT_INDEX_FILE
git read-tree HEAD || {
  echo "SKIP  the self-test needs a commit to seed its index; repository has no HEAD"
  exit 0
}

# Inside the working tree, because that is the only place `git add` will take a
# path from. Under a name this run invented, so a fixture can never land on a
# file the user already had.
FIXTURES="$(mktemp -d -p "$ROOT" .hook-selftest.XXXXXXXX)" || exit 1

# Fixtures are removed on any exit path, including an interrupted one. Never
# clean with a `_t_*` wildcard: that would also match a real file.
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
  rm -rf -- "$FIXTURES"
  rm -f -- "$OUT"
  rm -rf -- "$(dirname "$GIT_INDEX_FILE")"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# fixture <name> -> a path nothing else in the repository can be using
fixture() {
  local path="$FIXTURES/$1"
  fixtures+=("$path")
  printf '%s' "$path"
}

stage() {
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
ws=$(fixture _t_ws.txt)
printf 'ok line\nbad line   \n' > "$ws"
stage "$ws"
expect_fail "trailing whitespace" "trailing whitespace in ${ws#"$ROOT"/}" "$ws"

# 2. CRLF. Note this does NOT exercise the hook: .gitattributes (`* text=auto
#    eol=lf`) normalises at `git add` time, so the index blob is already LF and
#    the hook's CRLF check is a backstop that cannot normally fire. The
#    invariant worth asserting is the one git actually guarantees - that no CR
#    reaches the stored blob.
crlf=$(fixture _t_crlf.txt)
printf 'first\r\nsecond\r\n' > "$crlf"
stage "$crlf"
if git cat-file blob ":${crlf#"$ROOT"/}" | grep -q "$(printf '\r')"; then
  echo "FAIL  CRLF normalisation -> CR present in the stored blob"; fail=$((fail+1))
else
  echo "ok    CRLF normalisation -> .gitattributes stripped CR at add time"; pass=$((pass+1))
fi
release "$crlf"

# 3. merge conflict marker
conflict=$(fixture _t_conflict.txt)
printf 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> other\n' > "$conflict"
stage "$conflict"
expect_fail "conflict marker" "merge conflict marker in ${conflict#"$ROOT"/}" "$conflict"

# 4. missing final newline
nonl=$(fixture _t_nonl.txt)
printf 'no trailing newline' > "$nonl"
stage "$nonl"
expect_fail "missing final newline" "does not end with a newline" "$nonl"

# 5. markdown hard line break must be ALLOWED
hardbreak=$(fixture _t_hardbreak.md)
printf 'line one  \nline two\n' > "$hardbreak"
stage "$hardbreak"
expect_pass "markdown hard break" "$hardbreak"

# 6. clean file must be ALLOWED
clean=$(fixture _t_clean.txt)
printf 'clean content\n' > "$clean"
stage "$clean"
expect_pass "clean text" "$clean"

# 7. binary file must be SKIPPED, not read as text. It carries trailing
#    whitespace on purpose: a hook that failed to skip it would block on the
#    whitespace check, so "allowed" only holds while the skip works.
binary=$(fixture _t_bin.bin)
printf 'bin\000ary content   \n' > "$binary"
stage "$binary"
expect_pass "binary skip" "$binary"

echo "----"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
