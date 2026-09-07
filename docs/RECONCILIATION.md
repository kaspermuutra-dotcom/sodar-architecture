# Reconciling the main checkout with `claude/fable-5-1-sodar-scanner-058940`

The main checkout (`main` at bb4feb4) holds **untracked, user-owned** files that
overlap paths committed on the scanner branch. Git refuses a checkout or merge
that would overwrite untracked files, and nothing here deletes them. Comparison
made on 2026-09-08 against the working tree; the branch versions are supersets
unless stated.

| Path | Main checkout (untracked) | Branch | Relationship |
|---|---|---|---|
| `site/lib/kiri/server.ts` | 100 lines: bearer client, balance, 20–300 validation, 3DGS job, status, zip URL | 139 lines | Same public functions and behaviour; adds `ProviderError` retry classes, timeouts, 403 = insufficient credits, `validateKiriImages`, `isKiriSerialize`, `kiriConfigured`. The user's original test file passes unchanged against the branch client (4/4). |
| `site/lib/kiri/server.test.ts` | 4 tests | 8 tests | Branch keeps all four original cases and adds status variants, 401/403/429, malformed responses, download URL validation. |
| `site/app/api/kiri/balance/route.ts` | returns the raw KIRI balance to any signed-in user | replaced | Branch version is authenticated and reports availability only; balances stay operator-side (`/api/reconstruction/estimate` is the customer view). |
| `site/app/api/kiri/jobs/route.ts` | uploads browser-supplied images straight to KIRI | replaced (410) | Bypassed ownership, consent, balance check, daily limits and idempotency; branch points to `POST /api/reconstruction/jobs`. |
| `site/app/api/kiri/jobs/[id]/route.ts` | polls KIRI directly by serialize | replaced | Branch resolves the serialize to an owned SODAR job and refreshes through the job service. |
| `scripts/run_capture_worker.py` | 144 lines: OpenCV `cv::Stitcher`, reflect-padding to 2:1 | 481 lines | Pose-guided stitch primary, OpenCV refinement fallback, coverage mask upload, 300-frame cap, gaps allowed; same Supabase claim/fail/log contract. |
| `tests/test_capture_backend.py` | 5 tests | 22 tests | Original assertions preserved (retry limit, RLS/idempotency checks), migration check skips when the file is absent. |
| `supabase/migrations/202609040001_capture_backend.sql` | — | identical byte-for-byte copy | Dependency of `202609070001_reconstruction.sql`. |
| `docs/CAPTURE_BACKEND.md`, `services/`, `scripts/test_image_enhancement.py`, `web/*`, `.mcp.json` | untracked / modified | not on branch | No overlap; untouched. |

## Procedure (no data loss)

The script lives on the branch, so run it from the **main checkout** root
straight out of git — no merge is needed first:

```sh
git show claude/fable-5-1-sodar-scanner-058940:scripts/reconcile_main_checkout.sh | sh -s --            # report: same / DIFFERS / only-here
git show claude/fable-5-1-sodar-scanner-058940:scripts/reconcile_main_checkout.sh | sh -s -- --apply    # back up outside the repo, then clear the paths
git merge claude/fable-5-1-sodar-scanner-058940
```

Backups go to `${TMPDIR:-/tmp}/sodar-reconcile-backup/<timestamp>/` (override
with `BACKUP_DIR=…`; a location inside the repository is added to
`.git/info/exclude` automatically). Each backed-up file is stored with a `.diff`
against the branch version. The script only ever touches the eight paths
above, only when they are untracked, and only after the backup copy exists.
Review the `.diff` files if anything in the user versions should be carried
forward; none of the original tests or public function names were dropped.
