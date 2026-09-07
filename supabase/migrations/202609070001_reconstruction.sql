-- SODAR reconstruction v1: provider-neutral jobs, artifacts with provenance,
-- webhook replay protection, usage limits, confirmed tour links, and capture
-- quality metadata. Depends on 202609040001_capture_backend.sql. Apply with the
-- Supabase CLI after review; forward-only.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.reconstruction_provider as enum ('kiri', 'marble');
create type public.reconstruction_status as enum (
  'draft','validating','needs_retake','ready_to_upload','uploading','queued','processing','downloading',
  'ready','partially_ready','failed','expired','cancelled'
);
create type public.artifact_type as enum (
  'original_frame','capture_manifest','capture_quality_report','coverage_mask','panorama_stitched_original','panorama_ai_completed',
  'kiri_gaussian_splat','kiri_mesh','marble_panorama','marble_gaussian_splat','marble_collider_mesh','marble_thumbnail','tour_manifest','processing_report'
);
create type public.artifact_provenance as enum ('captured','derived','ai_generated','mixed');
create type public.artifact_retention as enum ('retained','scheduled_for_deletion','deleted');

-- ---------------------------------------------------------------------------
-- Capture metadata additions
-- ---------------------------------------------------------------------------
alter table public.scans add column if not exists property_name text check (property_name is null or char_length(property_name) <= 120);
alter table public.scans add column if not exists ai_processing_consent_at timestamptz;
alter table public.scans add column if not exists deleted_at timestamptz;

alter table public.rooms add column if not exists capture_mode text not null default 'quick' check (capture_mode in ('quick','full3d'));
alter table public.rooms add column if not exists floor_label text check (floor_label is null or char_length(floor_label) <= 40);
alter table public.rooms add column if not exists quality_report jsonb;
alter table public.rooms add column if not exists confirmed_at timestamptz;
alter table public.rooms drop constraint if exists rooms_target_count_check;
alter table public.rooms add constraint rooms_target_count_check check (target_count between 0 and 300);
alter table public.rooms drop constraint if exists rooms_frame_count_check;
alter table public.rooms add constraint rooms_frame_count_check check (frame_count between 0 and 300);

alter table public.capture_frames add column if not exists quality_score double precision check (quality_score is null or quality_score between 0 and 1);
alter table public.capture_frames add column if not exists quality jsonb;
alter table public.capture_frames add column if not exists capture_mode text check (capture_mode is null or capture_mode in ('quick','full3d'));
alter table public.capture_frames add column if not exists station_index integer check (station_index is null or station_index between 0 and 63);
alter table public.capture_frames drop constraint if exists capture_frames_checkpoint_index_check;
alter table public.capture_frames add constraint capture_frames_checkpoint_index_check check (checkpoint_index between 0 and 299);

-- Tour links: provisional (machine-suggested) versus confirmed by the person who scanned.
alter table public.room_links add column if not exists confirmed boolean not null default false;
alter table public.room_links add column if not exists confirmed_at timestamptz;
alter table public.room_links add column if not exists updated_at timestamptz not null default now();
alter table public.room_links add column if not exists reverse_yaw_deg double precision;

-- ---------------------------------------------------------------------------
-- Reconstruction jobs: one row per (room, provider, input set). The unique
-- idempotency key is what prevents a second paid job on refresh or reconnect.
-- ---------------------------------------------------------------------------
create table public.reconstruction_jobs (
  id uuid primary key,
  scan_id uuid not null references public.scans(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider public.reconstruction_provider not null,
  status public.reconstruction_status not null default 'validating',
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  external_id text check (external_id is null or external_id ~ '^[A-Za-z0-9_-]{6,128}$'),
  submitted_at timestamptz,
  input_kind text not null default 'images' check (input_kind in ('images','panorama')),
  input_count integer not null default 0 check (input_count between 0 and 300),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  want_mesh boolean not null default false,
  estimated_credits numeric,
  actual_credits numeric,
  balance_before numeric,
  balance_after numeric,
  attempts integer not null default 0,
  next_poll_at timestamptz,
  last_polled_at timestamptz,
  provider_status_raw text,
  failure_code text,
  failure_message text,
  expires_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  trace_id text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (owner_id, scan_id) references public.scans(owner_id, id),
  foreign key (scan_id, room_id) references public.rooms(scan_id, id)
);
create index reconstruction_jobs_room_idx on public.reconstruction_jobs(room_id, created_at);
create index reconstruction_jobs_owner_day_idx on public.reconstruction_jobs(owner_id, created_at);
create index reconstruction_jobs_poll_idx on public.reconstruction_jobs(next_poll_at) where status in ('queued','processing');
create unique index reconstruction_jobs_external_idx on public.reconstruction_jobs(provider, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- Artifacts: every file SODAR keeps, captured or generated, with provenance.
-- ---------------------------------------------------------------------------
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.reconstruction_jobs(id) on delete set null,
  provider text not null check (provider in ('kiri','marble','sodar','openai')),
  artifact_type public.artifact_type not null,
  bucket_id text not null,
  object_path text not null unique,
  mime_type text not null check (char_length(mime_type) between 3 and 120),
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source_artifact_ids uuid[] not null default '{}',
  provider_job_id text,
  processing_version text not null,
  provenance public.artifact_provenance not null,
  ai_generated boolean not null default false,
  retention public.artifact_retention not null default 'retained',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((ai_generated and provenance in ('ai_generated','mixed')) or (not ai_generated and provenance in ('captured','derived')))
);
create index artifacts_scan_idx on public.artifacts(scan_id, artifact_type);
create index artifacts_room_idx on public.artifacts(room_id, created_at);

-- Webhook replay protection: a provider event id is recorded once.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider public.reconstruction_provider not null,
  event_id text not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- Per-user daily usage of credit-consuming helpers (Astra review, AI fill).
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('astra_review','ai_fill')),
  created_at timestamptz not null default now()
);
create index usage_events_owner_idx on public.usage_events(owner_id, kind, created_at);

-- Private bucket for every reconstruction output. No MIME allow-list: models come as ply/spz/glb/zip.
insert into storage.buckets (id, name, public, file_size_limit)
values ('reconstruction-artifacts','reconstruction-artifacts', false, 1610612736)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Row level security: owners read their own rows; every write goes through the
-- service role on the server. Browsers never write jobs or artifacts.
-- ---------------------------------------------------------------------------
alter table public.reconstruction_jobs enable row level security;
alter table public.artifacts enable row level security;
alter table public.webhook_events enable row level security;
alter table public.usage_events enable row level security;

create policy reconstruction_jobs_owner_select on public.reconstruction_jobs for select to authenticated using ((select auth.uid()) = owner_id);
create policy artifacts_owner_select on public.artifacts for select to authenticated using ((select auth.uid()) = owner_id and retention <> 'deleted');
create policy usage_events_owner_select on public.usage_events for select to authenticated using ((select auth.uid()) = owner_id);
-- webhook_events: no policy for authenticated → invisible to browsers.

drop policy if exists storage_owner_read on storage.objects;
create policy storage_owner_read on storage.objects for select to authenticated using (
  bucket_id in ('capture-originals','panorama-originals','panorama-cleaned','reconstruction-artifacts') and (storage.foldername(name))[1] = (select auth.uid())::text
);

grant select on public.reconstruction_jobs, public.artifacts, public.usage_events to authenticated;

-- ---------------------------------------------------------------------------
-- Poll claim: a cron worker takes due jobs and pushes their next_poll_at
-- forward atomically, so two overlapping workers never poll the same job.
-- ---------------------------------------------------------------------------
create or replace function public.claim_reconstruction_polls(p_limit integer default 10, p_now timestamptz default now())
returns setof public.reconstruction_jobs language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    select id from public.reconstruction_jobs
    where status in ('queued','processing') and external_id is not null and (next_poll_at is null or next_poll_at <= p_now)
    order by next_poll_at nulls first
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  )
  update public.reconstruction_jobs j set next_poll_at = p_now + interval '45 seconds', updated_at = now()
  from due where j.id = due.id
  returning j.*;
end $$;
revoke all on function public.claim_reconstruction_polls(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_reconstruction_polls(integer, timestamptz) to service_role;

-- Deletion helper: marks every artifact of a scan for deletion; object removal
-- is performed by the server route, which then flips retention to 'deleted'.
create or replace function public.schedule_scan_deletion(p_scan_id uuid, p_owner_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  update public.artifacts set retention = 'scheduled_for_deletion' where scan_id = p_scan_id and owner_id = p_owner_id and retention = 'retained';
  get diagnostics v_count = row_count;
  update public.scans set deleted_at = now(), updated_at = now() where id = p_scan_id and owner_id = p_owner_id;
  return v_count;
end $$;
revoke all on function public.schedule_scan_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.schedule_scan_deletion(uuid, uuid) to service_role;
