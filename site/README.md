# sodar.io — site

Marketing site for **sodar.io** — Next.js 15 (App Router, TypeScript), Tailwind 4,
next-intl locale routing, GSAP for motion. Deployed on Vercel (project Root
Directory = `site`), Supabase env stubs wired for phase 2.

## Local development

```bash
cd site
npm install
cp .env.example .env.local   # optional until the workspace reads data
npm run dev                   # http://localhost:3000
npm run typecheck
```

## Design system — "Mono Scan"

Pure black page, warm off-white type, **no colour accent**: white is the only
accent (the scan-line, active states). All tokens live in `app/globals.css`
under `@theme`.

- Display: Instrument Serif (`.display`, `.section-title`)
- Body: Inter · Data / status strings: JetBrains Mono (`.mono-label`, `.ticker`)
- Artifacts: film grain (`.grain`), vignette, hairline grid (`.hairgrid`), the
  scan-line motif (`components/scan-reveal.tsx`), room marquee.
- Logo: `components/logo.tsx` — SVG approximation of the S mark. Replace the
  `<path>` with the real mark's path when exported.

## Motion

Every GSAP effect checks `prefersReducedMotion()` from `lib/motion.ts`, which is
true for the OS setting **or** `?motion=off` in the URL. Use `?motion=off` for
screenshots / visual QA so you see final states instead of frozen tweens.

Signature pieces: `components/mosaic-grid.tsx` (hero wall: random stagger,
scan sweep, cursor drift), `components/pipeline.tsx` (pinned, scroll-scrubbed
Capture → Preview → Unlock → Publish), `components/manifesto.tsx`
(scroll-lit thesis lines), `components/stats-band.tsx` (counters).

## Media

Generated assets go under `public/media/` — see [`MEDIA_PLAN.md`](MEDIA_PLAN.md)
for the Higgsfield shot list and commands. `public/media/rooms/tile-NN.jpg`
(45 tiles) are currently crops of `public/sodar-apartment-hero.png` as
stand-ins.

## Supabase

- `lib/supabase/env.ts` — reads and validates the two public env vars
- `lib/supabase/health.ts` — connectivity check (`components/dev-status.tsx`)

Never put the `service_role` key in a `NEXT_PUBLIC_` variable.
