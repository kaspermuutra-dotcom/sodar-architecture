# External API Options — Sodar Orchestration Layer

Boundary-by-boundary survey of what can sit behind each external node in the
[system map](../../README.md#system-map). One working recommendation per boundary.

- Prepared 2026-08-28 · for review, not committed to
- Pricing figures are directional (public comparison sources, 2026-08) and move
  fast — confirm current + enterprise/API terms with each vendor.

---

## 01 · Capture AI — live frame quality scoring

**Need:** the only two-way edge in the system — a frame goes up, a score comes
back *while the agent is still in the room*. The schema's quality fields
(`blur`, `exposure_score`, `rotation_rate`, `delta_yaw`) are classical signal
metrics, not deep-learning outputs, so an on-device path is both viable and
preferable — a network round-trip per frame breaks the real-time loop.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **In-browser classical CV** *(lead)* — Web Worker + Canvas + `DeviceOrientation` | Laplacian/Brenner variance for sharpness, luma histogram for exposure, device IMU for yaw rate. No model, no server. | $0/frame, build only | Covers all four schema fields directly. Zero latency, works offline. |
| Roboflow *(external)* — roboflow.js / hosted workflow | "Camera Focus" block scores sharpness via the Brenner measure; deployable to browser/edge. Managed training if heuristics under-perform. | usage-based, free dev tier | Good escalation if false-accepts are too high — a second opinion, not the primary loop. |
| TensorFlow.js custom IQA | Train a small image-quality model, ship to the client. | $0/frame, ML effort | Only if classical metrics prove insufficient in field testing. |
| Cloud vision — AWS Rekognition / Google Vision | Server-side analysis, per-call pricing. | ~$1–1.50 / 1k images | Rejected for the live loop; possible for a one-time post-capture audit. |

**Recommendation:** classical metrics in a Web Worker + `DeviceOrientation` for
yaw. Hold roboflow.js in reserve as a second-pass check if field data shows bad
frames slipping through.

---

## 02a · Reconstruction — panorama stitching & 3D

**Need:** async (a multi-room job runs past any HTTP timeout). README keeps queue
and stitching *owned*; neural reconstruction is where an external model earns its
place. Two sub-decisions: the base 360° panorama, and the "AI-reconstructed"
walkable upgrade.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **Owned stitcher on the worker** *(lead, base layer)* — OpenCV Stitcher / PTGui CLI / Hugin | Deterministic spherical stitching into a 360° panorama per room, on the container worker the infra plan already calls for. | compute only, no vendor fee | Base layer for every tour. Full control. No neural gap-fill/parallax alone. |
| **Luma AI** *(external, upgrade)* — enterprise API | Cloud Gaussian-splatting from phone photos/video → photoreal interactive scene + exportable assets. Best consumer-grade quality signal. | enterprise, contact sales | Matches the "AI-reconstructed 360° tour" promise. API + commercial licensing gated to enterprise tier. |
| Polycam *(external)* — Polycam for Teams / API | Photogrammetry + LiDAR + GS modes, plus floor plans and room measurements from the same capture. | ~$150/yr Pro, team pricing above | Attractive if floor area / room dimensions should feed the pricing engine. |
| Self-hosted 3DGS — Nerfstudio / gsplat / Brush | Open-source Gaussian-splatting on a GPU worker. | GPU hours + ops burden | Long-term destination if scan volume makes a per-scan vendor fee expensive. Not a launch choice. |
| Matterport *(external)* — SDK / Model API | Polished dollhouse tours, mature web viewer/embed SDK. | per-space subscription | Hardware/subscription-oriented; heavier than "scan with any phone." Better as viewer-UX reference. |

**Recommendation:** two-tier — owned OpenCV/PTGui stitcher for the base 360°,
Luma's enterprise API for the neural walkable upgrade, preserving cluster 02's
"owned queue + stitch, external reconstruction" split. Re-evaluate self-hosted
3DGS once monthly scan volume is known. Get Luma + Polycam API pricing first.

---

## 02b · Image enhancement

**Need:** the README's *Image Enhance (external)* node — sharpen and fill gaps on
rendered panorama tiles. Key constraint: **fidelity over flair** — a property
image that hallucinates a window or fireplace is a legal problem, not a nicer
photo.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **Replicate** *(external, lead)* — one API, many models | Single endpoint over Topaz `image-upscale` (5 content-tuned models, up to 6×, face enhance), `real-esrgan` for cheap batch, SUPIR, Clarity. Swap models without re-integrating. | per GPU-second, no infra | Best launch choice — one integration, model choice stays open. |
| Topaz Labs API *(external)* — direct or via Replicate | Highest measured fidelity on real photos (~35–38 dB PSNR portrait benchmarks). Restoration, not reinterpretation. | credit packs / per-image | The model to default to inside Replicate for property imagery. |
| Self-hosted Real-ESRGAN *(owned)* — on the worker GPU | Open-source upscaler, no per-image cost, predictable output. | GPU hours only | Move the hot path here once per-image pricing hurts. Same model family Replicate would run. |
| Freepik / Magnific API *(external)* — creative upscaler | Text/style-guided enhancement, up to 16×, "creativity slider." | per image (premium) | **Avoid for listings** — it reinterprets detail. OK only for marketing hero crops. |
| Let's Enhance / Claid.ai *(external)* — SaaS enhancement API | Product-photo-oriented API, bulk endpoints, lighting normalization. | tiered subscription | Worth a look for batch consistency across a scan; less model flexibility than Replicate. |

**Recommendation:** ship on Replicate with the Topaz upscale model (zero infra,
swappable). Migrate steady-state load to a self-hosted Real-ESRGAN worker once
volume is established. Keep creative upscalers out of the tour path.

---

## 04 · Commerce — payments

**Need:** a one-time fee sized to the listing. README's shape is already right —
the external service owns checkout UI + receipts, and a webhook is the only state
change on Sodar's side (`checkout.session.completed` → `payments` row →
`status = paid`). Real question: processor vs. merchant-of-record.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **Stripe Checkout** *(external, lead — current design)* | Hosted checkout, dynamic one-time amount, receipts, the webhook Sodar already plans to consume. Stripe Tax add-on for VAT/sales tax. | 2.9% + 30¢ + tax add-on | Already in the diagram and the right integration shape. You carry tax-registration responsibility. |
| Paddle *(external)* — merchant of record | Paddle is seller of record; handles global sales tax/VAT, invoicing, chargebacks. | ~5% + fees | Worth the premium once Sodar sells cross-border and tax compliance is real work. Same webhook pattern. |
| Lemon Squeezy *(external)* — MoR (Stripe-owned) | Simplest indie MoR; flat pricing, no monthly fee. Now owned by Stripe, roadmap converging. | 5% + 50¢ | Fast to stand up, but the future is folding into Stripe's own MoR. |
| Polar *(external)* — developer-first MoR | Cheapest MoR, usage-billing friendly, clean API. | ~4% + fees | Aimed at developer-tooling sellers; agent buyers aren't its core market. |
| Stripe MoR *(external)* — private beta, 2026 | Stripe's own MoR layer on top of the processor. | +3.5% over standard | Natural upgrade path from Stripe Checkout — watch for GA before picking a third-party MoR. |

**Recommendation:** stay on Stripe Checkout — the webhook-only integration is
already correct. Add Stripe Tax when the first foreign sale lands; evaluate
Paddle or Stripe's own MoR only when cross-border tax filing becomes a burden.

---

## 05 · Delivery — embed help & listing portals

**Need:** two external nodes. *Embed AI* is scoped to portal-specific setup
instructions — explicitly "not a general assistant." *Listing Portal* is just the
iframe host: the tour ships as an `<iframe>` in a listing, so no portal API is
required unless Sodar later wants to *read* listing data.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **Snippet generator, no LLM** *(owned, lead)* — form → copy-paste + screenshots | The portals agents use are a known finite set. A "which portal?" form returning the exact iframe snippet + annotated screenshots is deterministic and free. | $0 | More reliable than a chatbot for a bounded problem. Covers top portals day one. |
| **Claude API** *(external, fallback)* — Messages + tool use | Tightly scoped system prompt with per-portal instructions as context; answers "my portal isn't listed" and cites the generated snippet. | per token (low, scoped) | The right escape hatch for the long tail — small surface, easy to constrain. |
| Plain iframe embed *(owned)* — the delivery mechanism | Share page renders the tour; portal hosts an iframe. Gated on `status = paid`. | $0 | This *is* delivery. No portal API needed for the core product. |
| Aggregator property API *(external)* — RealtyAPI / Datafiniti | One API across Zillow, Redfin, Realtor, Rightmove, Zoopla for listing data. | tiered per-request | Fastest way to auto-fill `listings.address` / `price_quote` if that becomes a feature. Check licensing per source. |
| RESO Web API / Bridge *(external)* — MLS standard feed | Industry-standard REST/JSON/OAuth2 feed. Bridge Interactive (Zillow) aggregates + normalizes. | data license per MLS | Heavy: a license per MLS (580+ for full US), approval needs MLS/vendor status. Only if deep listing integration becomes core. |

**Recommendation:** ship a deterministic snippet generator for known portals +
a tightly-scoped Claude API fallback for unlisted ones. The iframe is the
delivery path — no portal API at launch. If auto-filling listing metadata
becomes a feature, start with an aggregator API, not direct MLS licensing.

---

## 06 · Analytics — event tracking

**Need:** every visit + lead becomes an event; the Control Panel is a per-agent
rollup (visits, leads, timing, source portal). The schema already has
`analytics_events` — decision is whether that's enough or whether to route events
to a dedicated store.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **Supabase `analytics_events`** *(owned, lead)* — Postgres + `pg_cron` rollup | Write events to the table already in the schema; a cron job rolls them into a per-agent panel view. One database, transactional with the rest. | included in Supabase | Right for launch volume. Put a thin write-abstraction in front so a second sink can be added without touching call sites. |
| PostHog *(external)* — EU hosting available | Event capture from embed + server; HogQL query API drives the rollups. Session replay + flags included. | generous free tier, then usage | The obvious upgrade when Postgres aggregates strain — query API fits the rollup use case. |
| Tinybird *(external)* — ClickHouse + SQL API | Stream events via Events API; expose rollups as parameterized SQL endpoints. Built for engagement dashboards at scale. | usage-based | Best if analytics becomes a headline feature with heavy per-agent querying. You build the UI. |
| Segment *(external)* — routing layer | Capture once, fan out to PostHog + a warehouse. | MTU-based (adds up) | Only worth it with several downstream destinations — premature here. |

**Recommendation:** use the Supabase `analytics_events` table with a `pg_cron`
rollup for launch. Write events through a one-function abstraction so they can be
teed to PostHog (or Tinybird) the moment rollup queries strain Postgres.

---

## X1 · Orchestration — queue & workflow engine

**Need:** cross-cutting, and build-sequence step 7. The reconstruction chain
(`queue → stitch → enhance → write assets`) must survive restarts, retry per
step, and run past any HTTP timeout — plus the one retry loop from the Review
Gate back into reconstruction. This is also the layer the WAT tools plug into.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **Supabase Queues (pgmq)** *(owned, lead)* — pgmq + `pg_cron` + worker | The queue lives in the Postgres you already run — enqueue transactionally with a `scans.status` change. A container worker pulls jobs. | included in Supabase | Most aligned with the "one data core" principle and the container-worker infra plan. You build retry/backoff/observability. |
| **Inngest** *(external, next step)* — event-driven step functions | Multi-step workflows in TypeScript, independent per-step retries, local dev server, built-in observability. ~30 min to first deploy. | 25k runs/mo free, then usage | The upgrade when step-level retries, fan-out, and run history become the bottleneck. Steps map cleanly to the reconstruction chain. |
| Trigger.dev v3 *(external)* — code-first long tasks | Long-running tasks as plain async TS, deployed to their infra, realtime progress updates — useful for a live "rendering…" bar. | 50k runs free, then usage | Strong alternative to Inngest; pick on developer preference + value of realtime progress to the Review UI. |
| Temporal *(external)* — durable execution | Battle-tested standard: workflows as code, automatic retries, timers, signals, queries. | self-host or Temporal Cloud | Overkill now (2–3 day deploy). Destination if reconstruction grows into a many-step, mission-critical pipeline. |
| Upstash QStash *(external)* — HTTP message queue | Sends HTTP requests to your endpoints with delivery guarantees, retries, scheduling. | per message | Simplest if the worker is just HTTP endpoints and you want almost no infra. |
| Windmill *(external)* — scripts as workflows | Scripts-as-workflows + UI builder + schedules + native approval flows; self-hostable. | OSS / cloud seat-based | The approval-flow feature lines up with the Review Gate — worth a look if that gate grows complex. |

**Recommendation:** start with Supabase Queues (pgmq) — keeps pipeline state in
the one data core, adds no vendor, fits the container-worker infra plan. Move to
Inngest (or Trigger.dev) when per-step retries, fan-out, and run observability
become the limiting factor. Step 7 runs in parallel with steps 1–6, so this
doesn't block the earlier build.

---

## X2 · Data layer — storage & asset delivery

**Need:** Supabase (Postgres · Auth · Storage) is chosen. Adjacent decisions:
where raw frames and rendered tour assets live, and how the public tour is served
to portal visitors at scale.

| Option | What it is | Cost signal | Fit |
|---|---|---|---|
| **Supabase Storage** *(owned, lead)* — capture + working assets | S3-compatible, RLS-aware, resumable (TUS) uploads for large multi-room frame sets. Same auth model as the DB. | included + GB overage | Right for ingest + intermediate assets — one permission model; upload path is build-sequence step 2. |
| Cloudflare R2 + CDN *(external)* — public tour bundle | Zero egress fees, cheap at delivery scale, behind Cloudflare's CDN. | no egress fees | Move published, paid tour assets here once portal-visitor traffic grows — egress is where Storage costs climb. |
| imgix / Cloudflare Images *(external)* — responsive panorama tiles | On-the-fly resize / format / tile for panorama delivery across devices. | per image / per transform | Optional — Supabase image transforms may cover it until tile volume justifies a dedicated service. |
| Supabase CLI migrations *(owned)* — schema as code | Versioned SQL migrations, Postgres branching for preview envs. What the WAT `data_pipeline_agent` drives. | included | Already the plan — no alternative needed. |

**Recommendation:** Supabase Storage for ingest + working assets. Plan to serve
the published paid tour from Cloudflare R2 behind a CDN once portal-visitor view
traffic is material — the point where egress, not storage, becomes the cost
driver.

---

## Mapping to the build sequence

| Step | Picks |
|---|---|
| 1–2 · Data & ingest | Supabase Postgres/Auth/Storage; CLI migrations via the WAT data-pipeline agent |
| 3 · Status & review gate | Enforced in Postgres; Windmill-style approval flows only if the gate grows complex |
| 4 · Pricing & payment | Stripe Checkout, webhook-only; Stripe Tax on first foreign sale |
| 5 · Embed gating | Iframe + `status = paid`; snippet generator + scoped Claude API fallback |
| 6 · Control panel | Supabase rollup via `pg_cron`; tee to PostHog when queries strain |
| 7 · Reconstruction (parallel) | pgmq queue + owned stitcher + Replicate (Topaz) enhance + Luma upgrade; escalate to Inngest |
| 8 · Infra split | Container worker (Fly / Render / Railway) scaled separately from web — unchanged by these picks |
| 9 · Capture AI + Embed AI | On-device classical CV for capture; scoped Claude API for embed help |

## On the README's open-question names

`Sigma`, `Admanage`, `Omni`, `Claude Commerse`, `Stich`, `Impeccable`,
`Leanxlnx`, `Sensor LLC`, `Graphify`, `SPAG-4D` — none resolve to an identifiable
public API from the names alone. They need a repo link or a one-line description
each before they can be slotted against the boundaries above. Recommend leaving
them flagged, as the README already does.

## Sources

Workflow orchestration: [Kestra](https://kestra.io/resources/infrastructure/temporal-alternatives) ·
[npow landscape 2026](https://npow.github.io/posts/workflow-orchestration-market-quadrant-2026/) ·
[PkgPulse Inngest/Trigger.dev/QStash](https://www.pkgpulse.com/guides/inngest-vs-triggerdev-vs-qstash-serverless-durable-2026) ·
[VibeReference background jobs](https://www.vibereference.com/backend-and-data/background-jobs-providers)

360 / reconstruction: [Matterport 2026](https://matterport.com/blog/best-virtual-tour-software-for-real-estate) ·
[SkyeBrowse Kuula vs CloudPano](https://www.skyebrowse.com/news/posts/kuula-vs-cloudpano) ·
[Utsubo Gaussian splatting guide](https://www.utsubo.com/blog/gaussian-splatting-guide) ·
[The Future 3D — Luma AI](https://www.thefuture3d.com/software/luma-ai/) ·
[TourReady Polycam vs Luma](https://tourready.ai/compare/polycam-vs-luma)

Image enhancement: [Let's Enhance — upscaler APIs](https://letsenhance.io/blog/all/best-upscaler-apis/) ·
[Replicate super-resolution](https://replicate.com/collections/super-resolution) ·
[Rangy best upscalers 2026](https://rangy.ai/blog/best-ai-image-upscaler-2026/) ·
[Roboflow camera quality](https://blog.roboflow.com/automate-camera-quality-monitoring/)

Payments: [FintechSpecs MoR decision](https://fintechspecs.com/blog/stripe-vs-paddle-vs-lemon-squeezy-vs-polar-merchant-of-record-b2b-saas/) ·
[TurboStarter SaaS payment providers](https://www.turbostarter.dev/blog/stripe-vs-lemonsqueezy-vs-polar-vs-creem-choosing-the-right-saas-payment-provider)

Real estate data: [ScrapingBee real estate APIs](https://www.scrapingbee.com/blog/best-real-estate-apis-for-developers/) ·
[Zillapi MLS / RESO](https://zillapi.com/blog/mls-api/) ·
[RealtyAPI](https://www.realtyapi.io/)

Analytics: [PostHog docs](https://posthog.com/docs/product-analytics/best-practices) ·
[Tinybird event tracking](https://dev.to/tinybirdco/build-a-real-time-event-tracking-api-with-tinybird-313o)

Virtual staging: [HousingWire 2026](https://www.housingwire.com/articles/virtual-staging-companies-apps/) ·
[AIGearBase REimagineHome](https://aigearbase.com/tool/reimaginehome)
