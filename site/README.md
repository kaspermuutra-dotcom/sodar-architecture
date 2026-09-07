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

Black page, warm off-white type, **no colour accent**. All tokens live in
`app/globals.css` under `@theme`. The second pass (September 2026) removed every
texture and ornament — grain, vignette, hairline grid, glows, section numbers,
arrow glyphs, the room marquee — and keeps motion to a few fades.

- Display: Instrument Serif (`.display`, `.section-title`)
- Body: Inter · Small labels only: JetBrains Mono (`.section-kicker`, `.mono-label`)
- Forms: `.field` / `.field-input` (contact and privacy forms, partner application)
- The one motif: the scan-line reveal (`components/scan-reveal.tsx`), toned down.
- Logo: `components/logo.tsx` — the official S mark.
- Company details (emails, phone, LinkedIn): `lib/company.ts`.

### Light bands

`.theme-light` (in `globals.css`) re-maps every design token to the cream
palette, so wrapping a group of sections in `<div className="theme-light">`
flips them Zobi-style without touching the components. The homepage alternates
dark hero / light thesis / dark pipeline / light capabilities / dark workspace /
light trust + pricing.

## Motion

Every GSAP effect checks `prefersReducedMotion()` from `lib/motion.ts`, which is
true for the OS setting **or** `?motion=off` in the URL. Use `?motion=off` for
screenshots / visual QA so you see final states instead of frozen tweens.

Pieces: `components/mosaic-grid.tsx` (hero wall, one staggered fade-in),
`components/intro-video.tsx` (the film, with a minimal control bar),
`components/pipeline.tsx` (Capture → Preview → Unlock → Publish as stacked
stages that fade in once), `components/manifesto.tsx` (scroll-lit thesis
lines), `components/stats-band.tsx` (counters).

## Contact forms

`components/contact-form.tsx` renders two audiences: the default posts to
`NEXT_PUBLIC_FORMSPREE_ID` (team@sodar.io) and `audience="privacy"` — used on
`/legal/privacy` only — posts to `NEXT_PUBLIC_FORMSPREE_PRIVACY_ID`
(privacy@sodar.io). Job title, phone (country-code selector in
`lib/dial-codes.ts`), subject and message are mandatory. Without a Formspree
id the form falls back to a pre-filled mailto.

## Scanner (`/scan`)

Every white "Scan a property" button opens `/scan`: a full-screen guided
capture built on the Photo Sphere Android app's logic
(`third_party/360-photo-app`, MIT), ported to the browser in `lib/scanner/sphere.ts` (target plan, projection,
alignment gate). Frames persist in IndexedDB (`lib/scanner/db.ts`); finishing a
room uploads them through `app/api/scanner/*` (Supabase auth + storage,
`lib/scanner/contracts.ts`) and queues a stitch job, then
`components/scanner/room-preview.tsx` shows the two stitched rooms in Photo
Sphere Viewer. Without a signed-in session frames stay on the phone. Default
scope is one ring per room; `/scan?scope=sphere` captures the full sphere.

## Contact

`components/contact-form.tsx` posts to Formspree when
`NEXT_PUBLIC_FORMSPREE_ID` is set (messages land at team@sodar.io) and falls
back to a pre-filled `mailto:` otherwise. The "I am a…" role is required.
Phone: +372 56666760. The form also sits under the privacy policy.

## Media

Generated assets go under `public/media/` — see [`MEDIA_PLAN.md`](MEDIA_PLAN.md)
for the Higgsfield shot list and commands. `public/media/rooms/tile-NN.jpg`
(45 tiles) are currently crops of `public/sodar-apartment-hero.png` as
stand-ins.

## Supabase

- `lib/supabase/env.ts` — reads and validates the two public env vars
- `lib/supabase/health.ts` — connectivity check (`components/dev-status.tsx`)

Never put the `service_role` key in a `NEXT_PUBLIC_` variable.
