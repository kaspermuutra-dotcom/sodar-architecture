# sodar.io — site

Blank Next.js (App Router, TypeScript) site for **sodar.io**, deployed on Vercel
with Supabase wired in.

## Local development

```bash
cd site
npm install
cp .env.example .env.local   # then fill in the two values
npm run dev
```

Open http://localhost:3000. The homepage shows a status dot for the Supabase
connection — green means the anon key reaches the project's REST endpoint.

## Environment variables

| Name | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → anon / public key |

Both are safe to expose to the browser. Never put the `service_role` key in a
`NEXT_PUBLIC_` variable.

## Deployment

Vercel builds this directory (project **Root Directory** is set to `site`).
Pushes to `main` deploy to production; other branches get preview URLs.

## Supabase clients

- `lib/supabase/client.ts` — for Client Components
- `lib/supabase/server.ts` — for Server Components, Route Handlers, Actions
- `lib/supabase/health.ts` — the connectivity check the homepage renders
