# SODAR scanner — architecture, providers, privacy, operations

Status: implemented on branch `claude/fable-5-1-sodar-scanner-058940` (2026-09-07).
Companion documents: [`CAPTURE_BACKEND.md`](CAPTURE_BACKEND.md) (capture tables,
worker, storage buckets — user-owned), [`PANORAMA_STACK.md`](PANORAMA_STACK.md).

## 1. End-to-end capture flow

```
welcome ─ mode ─ permissions ─ tutorial ─ people ─ capturing ─ checking ─ review ─ saving ─ consent ─ results
                                                    │  pause / move / retake
                                                    └─ every frame → IndexedDB before it counts
```

| Customer stage (UI)            | What happens                                                                                                                                                                         | Code |
|--------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------|
| Choose mode                    | *Quick panorama* (rotational, one spot) or *Full 3D scan* (default; translated stations around the room). Room size picks 40–80 or 80–150 targets.                                    | `lib/scanner/plan.ts` |
| Preparing camera               | Motion permission (iOS gesture), rear **wide** camera selection avoiding ultra-wide/tele, continuous focus, exposure lock after the first frame, camera confirmation screen.           | `lib/scanner/camera.ts`, `components/scanner/use-orientation.ts` |
| 20-second tutorial, clear room | Four cards per mode; checklist to remove moving people, switch lights on.                                                                                                             | `components/scanner/tutorial.tsx` |
| Scanning the room              | Orientation → outlier filter → target projection → alignment gate (dwell) → still capture. Full 3D asks the person to *walk with the phone down* between stations and tap "I'm in position"; auto-pauses when the page is hidden. | `components/scanner/scanner.tsx`, `lib/scanner/sphere.ts` |
| Local quality gates            | Sharpness (Laplacian variance), brightness, clipping, duplicate similarity, orientation jump, angular speed, timing, resolution, format. `blocking` frames are not saved; `retake` frames are saved and listed; `info` is a hint. | `lib/scanner/quality.ts` |
| Checking coverage              | Room gate (counts, coverage of the plan, horizon sectors, soft-frame ratio) + on-device WebGL panorama preview (2048 px).                                                             | `lib/scanner/quality.ts`, `lib/scanner/stitch.ts` |
| A few photos need attention    | GPT-6 Astra review of ≤ 8 thumbnails with physical instructions; per-frame retakes (the new frame replaces the old one, same checkpoint); override allowed for non-blocking findings. | `app/api/astra/route.ts`, `components/scanner/review-panel.tsx` |
| Saving original photos         | Sign-in (e-mail code) → resumable upload of immutable originals (3 concurrent, backoff, fresh grant on stale ticket, same frame id) → stitched original + coverage mask (+ AI completion) stored as artifacts with SHA-256 and provenance. | `lib/scanner/upload.ts`, `app/api/scanner/uploads/*`, `app/api/scanner/panoramas/route.ts` |
| Build your 3D space? (consent) | Server estimate (availability, credits, daily limit) → explicit confirmation → idempotent job creation per provider.                                                                | `components/scanner/consent-sheet.tsx`, `app/api/reconstruction/estimate`, `app/api/reconstruction/jobs` |
| Building your 3D space         | Server polls providers with backoff when due (request, cron or webhook), copies every output into private storage, records cost. Client polls the room view every 8 s while visible.  | `lib/reconstruction/service.ts` |
| Your room is ready             | Captured vs AI-completed panorama toggle with disclosure, splat viewer (gsplat, progressive), downloads via 10-minute signed URLs, walkthrough (Photo Sphere Viewer), doorway confirmation, deletion. | `components/scanner/results-view.tsx`, `room-preview.tsx`, `tour-editor.tsx`, `splat-viewer.tsx` |

Interruption recovery: the session (mode, phase, plan start heading, per-room
status, upload progress, job ids) is saved on every change; on return the
scanner offers **Continue scan** or **Start over** (start over supersedes the
session record but keeps its photos until deleted). Uploads resume from the
per-frame ticket/receipt in IndexedDB; reconstruction requests reconnect to the
existing job through the idempotency key. Local originals are never deleted by
the upload path.

## 2. Provider decision matrix

| Need                                   | Provider                     | Why                                                                                          | Guard rails |
|----------------------------------------|------------------------------|----------------------------------------------------------------------------------------------|-------------|
| Semantic capture review before paying   | GPT-6 Astra (`/api/astra`)   | Sees blur, glare, moving people, plain walls, inconsistent frames; gives one physical instruction per issue. | Bounded input (≤ 8 low-detail thumbnails), strict JSON schema, prompt forbids geometry inference / location / measurements / claiming completion; authenticated + daily limit. |
| Faithful 3D                             | KIRI Engine 3DGS (`lib/reconstruction/kiri.ts`) | Photogrammetric splat from originals only.                                                    | 20–300 JPEG/PNG, balance check, idempotency key, outputs copied within KIRI's ~3-day retention, zip unpacked defensively. |
| Bounded panorama completion             | GPT Image 2 edit (`/api/ai-fill`) | Paints only transparent mask regions (unseen caps, thin gaps).                                | Fixed server-side prompt (no redesign / furniture / features), stitched original + coverage mask always kept, derivative labelled `mixed`/AI. |
| Immersive explorable world              | World Labs Marble (`lib/reconstruction/marble.ts`) | Generative world from images or a panorama.                                                    | `disable_recaption`, `reconstruct_images`, constraint prompt, private permission; every output labelled `ai_generated`; optional; never blocks KIRI. |

Default routing (`RECONSTRUCTION_MODE=dual`): Astra review → local + Astra gate
passed → KIRI (faithful) and Marble (optional) as independent jobs; GPT Image 2
only on request from the results screen. Provider failure yields a partial
result (`partially_ready`), never a lost room.

## 3. Provider-neutral contract

`lib/reconstruction/contract.ts` defines `ReconstructionProvider` (capability,
input validation, cost estimate, balance, submit, status, fetchOutputs,
optional cancel), normalized statuses (`draft … cancelled`), artifact types,
provenance (`captured | derived | ai_generated | mixed`), and `ProviderError`
with a retry class (`retryable | fatal | rate_limited | insufficient_credits |
unauthorized`). `lib/reconstruction/service.ts` is the only place that talks to
providers; `store.ts` is the persistence boundary (Supabase in production,
in-memory in tests).

### Replacing or adding a provider

1. Implement `ReconstructionProvider` in `lib/reconstruction/<id>.ts`; keep the
   vendor client in `lib/<vendor>/server.ts` (server-only, key read at call
   time). Map vendor states onto normalized statuses; classify HTTP errors.
2. Add the id to `PROVIDER_IDS`, the enum in a new migration
   (`reconstruction_provider`), `PROVIDERS` in `lib/reconstruction/index.ts`,
   and a flag in `config.ts`.
3. Add mocked tests: auth failure, malformed response, each vendor state, rate
   limit, download URL validation, provenance of outputs.
4. Add customer-facing strings (`Scanner.consent.<id>`, `Scanner.results.*`).

## 4. Artifact lifecycle and retention

| Artifact                          | Producer        | Provenance     | Bucket / path                                                | Retention |
|-----------------------------------|-----------------|----------------|--------------------------------------------------------------|-----------|
| `original_frame`                  | phone           | captured       | `capture-originals/<user>/<scan>/<room>/frames/<frame>.jpg`   | until the person deletes the scan |
| `panorama_stitched_original`      | on-device WebGL | captured       | `reconstruction-artifacts/<user>/<scan>/<room>/sodar/panorama-original.jpg` | same |
| `coverage_mask`                   | on-device WebGL | derived        | `…/sodar/coverage-mask.png` (white = not captured)            | same |
| `panorama_ai_completed`           | GPT Image 2     | mixed (AI)     | `…/sodar/panorama-ai-completed.jpg`, sources = original + mask | same |
| `kiri_gaussian_splat` (zip + ply) | KIRI            | captured       | `…/kiri/<job>/…`                                              | KIRI keeps ~3 days; SODAR copy is permanent |
| `kiri_mesh`                       | KIRI            | derived        | `…/kiri/<job>/…`                                              | same |
| `marble_*` (pano, spz full_res + 500k, collider, thumbnail) | Marble | ai_generated | `…/marble/<job>/…`                                        | Marble keeps worlds in the account; URLs treated as temporary |
| `tour_manifest`                   | server          | derived        | built on request (`GET /api/scanner/scans/:id/tour`)          | — |

Every row in `public.artifacts` records id, scan, room, owner, provider, type,
bucket, object path, MIME type, byte size, SHA-256, source artifact ids,
created time, provider job id, processing version, provenance, `ai_generated`
and `retention` (`retained | scheduled_for_deletion | deleted`).

Deletion (`DELETE /api/scanner/scans/:id` with `{confirm: id}`) removes every
object in every bucket, marks artifacts `deleted`, deletes frame rows and
cancels active jobs. Provider-side copies are outside SODAR's control: KIRI
purges after ~3 days; Marble worlds stay in the World Labs account until
deleted there (`DELETE /marble/v1/worlds/{id}` — not automated yet).

## 5. Privacy boundaries

- Keys live only on the server (`OPENAI_API_KEY`, `KIRI_API_KEY`,
  `WORLDLABS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `KIRI_WEBHOOK_SECRET`,
  `CRON_SECRET`); nothing provider-related is `NEXT_PUBLIC_`.
- Every credit-consuming endpoint is authenticated when Supabase is configured
  and counted per user per day; ownership is checked on every scan/room/job.
- Buckets are private; the browser only ever receives 5–10 minute signed URLs.
- Provider download URLs are validated (https, public hostname, no
  credentials, size cap, redirect re-validation) before the server fetches
  them; provider error detail never reaches the browser (trace id does).
- Logs carry ids, counts, durations and codes — never image bytes, keys,
  complete signed URLs or e-mail addresses.
- Photos leave the phone only after sign-in and a visible upload; external AI
  processing starts only after the consent sheet.
- Captured pixels and generated pixels are separate artifacts, separately
  labelled in metadata, the viewer, downloads and the tour manifest.

## 6. Security controls added

Constant-time webhook verification with replay ids (`webhook_events`),
idempotent job creation with compare-and-set status transitions, request-size
limits on every new route, MIME sniffing of uploaded panoramas, sanitized file
names, SSRF guard for provider URLs, zip-bomb/path-traversal guard for model
archives, per-user daily limits (`usage_events`), kill switch and per-provider
flags, RLS on all new tables (owner select only; writes via service role).

## 7. Environment variables (names only)

See `site/.env.example`. Required for the full flow: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`KIRI_API_KEY`, `WORLDLABS_API_KEY`. Optional: `OPENAI_ASTRA_MODEL`,
`OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `WORLDLABS_MODEL`,
`KIRI_WEBHOOK_SECRET`, `CRON_SECRET`, `KIRI_ENABLED`, `WORLDLABS_ENABLED`,
`ASTRA_ENABLED`, `AI_FILL_ENABLED`, `RECONSTRUCTION_MODE`,
`RECONSTRUCTION_KILL_SWITCH`, `SODAR_DAILY_*`, `SODAR_MAX_*`, `KIRI_MIN_BALANCE`,
`WORLDLABS_MIN_BALANCE`.

## 8. Local setup

```sh
cd site
npm ci
cp .env.example .env.local          # fill in Supabase + provider keys; leave what you do not have empty
npm run typecheck
npm test                            # mocked; never consumes credits
npm run dev                         # http://localhost:3000/scan (HTTPS or localhost is required for camera/motion)
```

Without Supabase the scanner runs fully on-device (capture, quality gates,
panorama preview, export); Astra and AI fill work with `OPENAI_API_KEY` under a
process-local rate limit; saving and 3D processing are disabled with a clear
message.

## 9. Deployment setup

1. Apply migrations in order with the Supabase CLI:
   `supabase/migrations/202609040001_capture_backend.sql` then
   `202609070001_reconstruction.sql` (`supabase db push --linked` after a
   `--dry-run`). Confirm the four private buckets exist.
2. Set the environment variables on the host (Vercel project root = `site`).
3. Schedule `GET /api/reconstruction/poll` every 2–5 minutes with
   `Authorization: Bearer $CRON_SECRET` (Vercel Cron `vercel.json`, or any
   scheduler). This copies finished models even when nobody has the page open —
   KIRI deletes them after ~3 days.
4. Optional: register the KIRI webhook (Settings » Webhooks) with callback
   `https://<host>/api/webhooks/kiri` and `KIRI_WEBHOOK_SECRET`. The route
   treats webhooks as hints and re-reads status from KIRI.
5. Enable e-mail OTP sign-in in Supabase Auth (the scanner uses
   `signInWithOtp` + `verifyOtp`).
6. Function limits: `/api/reconstruction/jobs` needs up to 300 s (uploads all
   originals to KIRI from the function). On a plan without long functions, move
   `ReconstructionService.createJobs` into the Python/Node worker.

## 10. Tests

```sh
npm test                 # vitest, mocked providers (contract, KIRI, Marble, service, webhooks, routes, plan, quality, tour, orientation, upload)
npm run typecheck
python3 -m unittest discover -s tests   # repo root: harness + worker (posed-stitch primary, OpenCV refinement fallback)
```

Live smoke test (disabled by default, consumes credits):

```sh
SODAR_LIVE_SMOKE=1 SODAR_LIVE_PROVIDER=kiri SODAR_LIVE_CONFIRM=yes SODAR_LIVE_FIXTURE_DIR=/path/to/unzipped-export KIRI_API_KEY=… npm run test:live
SODAR_LIVE_SMOKE=1 SODAR_LIVE_PROVIDER=marble SODAR_LIVE_CONFIRM=yes SODAR_LIVE_FIXTURE_DIR=/path/to/unzipped-export WORLDLABS_API_KEY=… npm run test:live
```

`SODAR_LIVE_FIXTURE_DIR` must point at an unzipped SODAR export ("Export
originals" on the results screen). The loader parses its `frames.json`
(sodar-frames.v2), selects one Full 3D room (`SODAR_LIVE_ROOM` = id, name or
1-based index; default: the first Full 3D room), and reads only the images that
room references: 20–40 distinct real JPEGs from at least three stations. Loose
folders of JPEGs, missing or ambiguous manifests, quick-panorama rooms,
duplicated bytes, thumbnails and paths outside the export are refused, so
credits are never spent on input a provider cannot reconstruct. It prints the
expected credit use, refuses to submit without `SODAR_LIVE_CONFIRM=yes`,
records the external job id in `$TMPDIR/sodar-live-smoke.json`, polls with the
production adapter and writes the outputs next to the record. Credentials are never printed.

## 11. Failure recovery and runbook

| Symptom                                 | Where to look                                                                 | Action |
|-----------------------------------------|-------------------------------------------------------------------------------|--------|
| Job stuck in `queued`/`processing`      | `reconstruction_jobs.next_poll_at`, `diagnostics.pollFailures`, logs `reconstruction_poll_failed` | Confirm the cron is running; `GET /api/reconstruction/jobs/:id` forces a due poll; after 8 consecutive failures the job fails with the provider code. |
| `provider_expired`                      | KIRI deleted the model before SODAR downloaded it (cron not running > 3 days) | Fix the cron; the person can start a new job (new consent). |
| `insufficient_credits`                  | provider balance                                                              | Top up in the provider console; no automatic retry happens. |
| `download_failed` after retries         | logs `processing_failed stage=download`, provider URL validity                | Check the provider's download endpoint; the job returns to `processing` up to 5 times before failing. |
| Webhook 401/503                         | `webhook_rejected reason=…`                                                   | Align `KIRI_WEBHOOK_SECRET` with the dashboard; 503 means the secret is unset. |
| Duplicate charge suspected              | `reconstruction_jobs.idempotency_key`, `external_id`                          | One external id per key by design; compare `balance_before/after`. |
| Pause everything                        | `RECONSTRUCTION_KILL_SWITCH=1`                                                | Stops new submissions, Astra and AI fill; polls/downloads continue. |
| Person lost a room on the phone         | IndexedDB `sodar-scanner-v1` (sessions, frames), `sodar-panoramas-v1`         | "Continue scan" restores; export zip contains originals + panoramas + `frames.json`. |

## 12. Cost controls

Explicit consent sheet (providers, outputs, credits, disclosure, daily counter)
→ server balance check (`KIRI_MIN_BALANCE`, `WORLDLABS_MIN_BALANCE`) → one job
per idempotency key → per-user daily limits (`SODAR_DAILY_JOBS_PER_USER`, Astra,
AI fill) → image caps (`SODAR_MAX_IMAGES_PER_JOB`, thinning keeps capture order)
→ no automatic resubmission after failure → kill switch and per-provider flags →
`RECONSTRUCTION_MODE` (kiri_only / marble_only / dual). Balances are never sent
to the browser.

## 13. Observability

Client events (allow-listed names, ids, counts, durations; `POST
/api/scanner/events`, beacon on page hide): capture_started, permission_denied,
frame_accepted, frame_rejected, room_completed, quality_review_requested,
retake_requested, upload_started, upload_resumed, reconstruction_submitted,
provider_status_changed, artifact_downloaded, processing_failed,
processing_completed, panorama_stitched, session_resumed, session_reset.
Server logs: `reconstruction_submitted`, `reconstruction_provider_status`,
`artifact_downloaded`, `processing_completed`, `processing_failed`,
`reconstruction_poll_failed`, `panorama_stored`, `tour_links_saved`,
`scan_deleted`, `provider_webhook`, `webhook_rejected`, `quality_review_completed`,
`ai_fill_completed`. Measured: frames per room, retake rate, capture and upload
durations, stitch duration (measured, not estimated), provider queue and
processing time (`submitted_at` → `finished_at`), artifact sizes, credits
consumed (`actual_credits`).

## 14. Known limitations (honest)

- KIRI's webhook signature format is not in the public docs; the route accepts
  an HMAC-SHA256 of the body or the shared secret as a token and relies on a
  status re-read, so a forged webhook can at most trigger one status call.
- KIRI does not publish a per-job credit price through the API; the consent
  sheet shows "provider-defined" and the actual deduction is recorded from the
  balance difference.
- Marble delivers splats as `.spz`. SODAR stores the full-resolution SPZ (and
  the 500k preview when present) and renders it natively with Spark
  (`@sparkjsdev/spark`, World Labs' three.js renderer) in
  `components/scanner/spz-viewer.tsx`; no PLY export is requested from the API.
  KIRI's `.ply`/`.splat` still open in the lighter gsplat viewer.
- The on-device panorama is a pose-projected preview (wrist-pivot parallax is
  not corrected); the server path refines yaw with ORB where texture allows.
- Exposure lock depends on the browser: Chrome on Android honours
  `exposureMode: manual`; Safari does not, so the stitcher's clamped gain
  compensation does the matching there.
- Uploading up to 300 originals to KIRI runs inside a 300 s function; large
  rooms on slow hosts should move that step to a worker.
- No physical-phone pass was possible in this environment; the flow was
  verified with mocked camera APIs, unit tests and the desktop demo room.

## 15. Reconciliation with the main checkout

See [`RECONCILIATION.md`](RECONCILIATION.md) and `scripts/reconcile_main_checkout.sh`
for the overlapping untracked files and the backup-first procedure.
