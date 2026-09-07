#!/usr/bin/env sh
# Reconcile the main checkout's UNTRACKED scanner files with the branch versions
# BEFORE checking out / merging claude/fable-5-1-sodar-scanner-058940.
#
# The script lives on the branch, so run it from the MAIN checkout root straight
# out of git (no merge needed first):
#
#   git show claude/fable-5-1-sodar-scanner-058940:scripts/reconcile_main_checkout.sh | sh -s --            # report only
#   git show claude/fable-5-1-sodar-scanner-058940:scripts/reconcile_main_checkout.sh | sh -s -- --apply    # back up, then clear
#
# Nothing is deleted: every overlapping untracked file is copied, with a diff
# against the branch version, to a backup directory OUTSIDE the repository
# (default ${TMPDIR:-/tmp}/sodar-reconcile-backup/<timestamp>; override with
# BACKUP_DIR=...). Only after that copy exists is the working-tree path cleared
# so `git checkout` / `git merge` can proceed. Tracked files are never touched.
set -eu
BRANCH="${BRANCH:-claude/fable-5-1-sodar-scanner-058940}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "run inside the git repository" >&2; exit 2; }
cd "$ROOT"
git rev-parse --verify --quiet "$BRANCH^{commit}" >/dev/null || { echo "branch $BRANCH not found; fetch it first (git fetch origin $BRANCH:$BRANCH)" >&2; exit 2; }
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="${BACKUP_DIR:-${TMPDIR:-/tmp}/sodar-reconcile-backup}/$STAMP"
case "$BACKUP" in "$ROOT"/*) echo "note: backup directory is inside the repository; it will be excluded via .git/info/exclude" ;; esac
FILES="site/lib/kiri/server.ts site/lib/kiri/server.test.ts site/app/api/kiri/balance/route.ts site/app/api/kiri/jobs/route.ts site/app/api/kiri/jobs/[id]/route.ts scripts/run_capture_worker.py tests/test_capture_backend.py supabase/migrations/202609040001_capture_backend.sql"
echo "Repository: $ROOT"
echo "Branch:     $BRANCH   mode: $([ $APPLY = 1 ] && echo apply || echo report)"
CONFLICTS=0
for f in $FILES; do
  if [ ! -e "$f" ]; then echo "absent    $f"; continue; fi
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then echo "tracked   $f (left alone)"; continue; fi
  if ! git cat-file -e "$BRANCH:$f" 2>/dev/null; then echo "only-here $f (not on branch; no conflict)"; continue; fi
  if git show "$BRANCH:$f" | cmp -s - "$f"; then echo "same      $f (identical to branch)"; else echo "DIFFERS   $f (untracked here, different on branch)"; fi
  CONFLICTS=$((CONFLICTS + 1))
  if [ $APPLY = 1 ]; then
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp -p "$f" "$BACKUP/$f"
    git show "$BRANCH:$f" | diff -u "$f" - > "$BACKUP/$f.diff" || true
    rm -f "$f"
    echo "          backed up to $BACKUP/$f (+ .diff) and cleared"
  fi
done
if [ $APPLY = 1 ]; then
  case "$BACKUP" in "$ROOT"/*) rel=${BACKUP#"$ROOT"/}; top=${rel%%/*}; grep -qx "/$top/" .git/info/exclude 2>/dev/null || echo "/$top/" >> .git/info/exclude ;; esac
  echo "Backups: $BACKUP"
  echo "Next:    git merge $BRANCH      (or: git checkout $BRANCH)"
else
  [ $CONFLICTS -gt 0 ] && echo "$CONFLICTS untracked file(s) would block the merge; rerun with --apply to back them up and clear them."
fi
exit 0
