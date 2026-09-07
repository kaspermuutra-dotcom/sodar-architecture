-- SODAR capture backend v1. Apply with the Supabase CLI after review.
create extension if not exists pgcrypto;

create type public.scan_status as enum ('capturing','processing','preview_ready','ready','failed');
create type public.room_status as enum ('capturing','queued','stitching','ready','failed');
create type public.job_stage as enum ('stitch','cleanse');
create type public.job_status as enum ('queued','running','succeeded','failed','cancelled');
create type public.asset_kind as enum ('original_frame','stitched_original','cleaned_panorama','tour_manifest');

create table public.scans (
  id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  status public.scan_status not null default 'capturing', trace_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, id)
);
create table public.rooms (
  id uuid primary key, scan_id uuid not null references public.scans(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, ordinal integer not null check (ordinal between 1 and 100),
  name text not null check (char_length(name) between 1 and 120), status public.room_status not null default 'capturing',
  target_count integer not null default 0 check (target_count between 0 and 240), frame_count integer not null default 0 check (frame_count between 0 and 240),
  failure_code text, failure_message text, trace_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (scan_id, ordinal), unique (scan_id, id), foreign key (owner_id, scan_id) references public.scans(owner_id, id)
);
create table public.capture_frames (
  id uuid primary key, scan_id uuid not null, room_id uuid not null, owner_id uuid not null references auth.users(id) on delete cascade,
  checkpoint_index integer not null check (checkpoint_index between 0 and 239), checkpoint_ring integer not null check (checkpoint_ring between 0 and 31),
  yaw double precision not null check (yaw between -360 and 360), pitch double precision not null check (pitch between -90 and 90), roll double precision not null check (roll between -180 and 180),
  target_yaw double precision not null, target_pitch double precision not null, target_elevation double precision not null,
  fov_horizontal double precision not null check (fov_horizontal between 1 and 179), fov_vertical double precision not null check (fov_vertical between 1 and 179),
  captured_at timestamptz not null, width integer not null check (width between 320 and 16384), height integer not null check (height between 320 and 16384),
  byte_size bigint not null check (byte_size between 1024 and 26214400), mime_type text not null check (mime_type = 'image/jpeg'),
  object_path text not null unique, sha256 text, confirmed_at timestamptz, trace_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now(),
  unique (room_id, checkpoint_index), foreign key (scan_id, room_id) references public.rooms(scan_id, id), foreign key (owner_id, scan_id) references public.scans(owner_id, id)
);
create table public.resumable_uploads (
  id uuid primary key default gen_random_uuid(), frame_id uuid not null unique references public.capture_frames(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, object_path text not null unique, expected_bytes bigint not null,
  state text not null default 'pending' check (state in ('pending','uploaded','confirmed','failed')), attempt_count integer not null default 0,
  expires_at timestamptz, confirmed_at timestamptz, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(), scan_id uuid not null references public.scans(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade, owner_id uuid not null references auth.users(id) on delete cascade,
  stage public.job_stage not null, status public.job_status not null default 'queued', idempotency_key text not null unique,
  attempts integer not null default 0, max_attempts integer not null default 3, available_at timestamptz not null default now(),
  claimed_at timestamptz, heartbeat_at timestamptz, worker_id text, diagnostics jsonb not null default '{}'::jsonb,
  failure_code text, failure_message text, trace_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz,
  unique (room_id, stage)
);
create table public.panorama_assets (
  id uuid primary key default gen_random_uuid(), scan_id uuid not null references public.scans(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade, job_id uuid references public.processing_jobs(id), owner_id uuid not null references auth.users(id) on delete cascade,
  kind public.asset_kind not null, bucket_id text not null, object_path text not null unique, source_asset_id uuid references public.panorama_assets(id) on delete restrict,
  width integer, height integer, byte_size bigint, sha256 text, immutable boolean not null default true,
  trace_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now(),
  check ((kind <> 'cleaned_panorama') or source_asset_id is not null), check (immutable), unique (room_id, kind)
);
create table public.room_links (
  id uuid primary key default gen_random_uuid(), scan_id uuid not null references public.scans(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, from_room_id uuid not null references public.rooms(id) on delete cascade,
  to_room_id uuid not null references public.rooms(id) on delete cascade, yaw_deg double precision not null default 0, pitch_deg double precision not null default 0,
  label text, provisional boolean not null default true, created_at timestamptz not null default now(), unique (from_room_id, to_room_id), check (from_room_id <> to_room_id),
  foreign key (owner_id, scan_id) references public.scans(owner_id, id),
  foreign key (scan_id, from_room_id) references public.rooms(scan_id, id),
  foreign key (scan_id, to_room_id) references public.rooms(scan_id, id)
);

create index capture_frames_room_idx on public.capture_frames(room_id, checkpoint_index);
create index jobs_claim_idx on public.processing_jobs(status, available_at, created_at) where status = 'queued';
create index panorama_scan_idx on public.panorama_assets(scan_id, kind);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('capture-originals','capture-originals',false,26214400,array['image/jpeg']),
  ('panorama-originals','panorama-originals',false,104857600,array['image/jpeg','image/png']),
  ('panorama-cleaned','panorama-cleaned',false,104857600,array['image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.scans enable row level security;
alter table public.rooms enable row level security;
alter table public.capture_frames enable row level security;
alter table public.resumable_uploads enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.panorama_assets enable row level security;
alter table public.room_links enable row level security;

create policy scans_owner_select on public.scans for select to authenticated using ((select auth.uid()) = owner_id);
create policy rooms_owner_select on public.rooms for select to authenticated using ((select auth.uid()) = owner_id);
create policy frames_owner_select on public.capture_frames for select to authenticated using ((select auth.uid()) = owner_id);
create policy frames_owner_insert on public.capture_frames for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy uploads_owner_select on public.resumable_uploads for select to authenticated using ((select auth.uid()) = owner_id);
create policy jobs_owner_select on public.processing_jobs for select to authenticated using ((select auth.uid()) = owner_id);
create policy assets_owner_select on public.panorama_assets for select to authenticated using ((select auth.uid()) = owner_id);
create policy links_owner_select on public.room_links for select to authenticated using ((select auth.uid()) = owner_id);

create policy storage_owner_read on storage.objects for select to authenticated using (
  bucket_id in ('capture-originals','panorama-originals','panorama-cleaned') and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- Writes use short-lived server-created signed upload grants. No browser UPDATE/DELETE
-- policy exists, which makes confirmed originals immutable to broker sessions.

create or replace function public.claim_stitch_job(p_worker_id text, p_visibility_seconds integer default 300)
returns setof public.processing_jobs language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.processing_jobs;
begin
  select * into v_job from public.processing_jobs
  where stage = 'stitch' and attempts < max_attempts and available_at <= now()
    and (status = 'queued' or (status = 'running' and heartbeat_at < now() - make_interval(secs => p_visibility_seconds)))
  order by created_at for update skip locked limit 1;
  if v_job.id is null then return; end if;
  update public.processing_jobs set status='running', attempts=attempts+1, claimed_at=now(), heartbeat_at=now(), worker_id=p_worker_id, updated_at=now()
  where id=v_job.id returning * into v_job;
  update public.rooms set status='stitching', updated_at=now() where id=v_job.room_id;
  return next v_job;
end $$;
revoke all on function public.claim_stitch_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_stitch_job(text, integer) to service_role;

grant select on public.scans, public.rooms, public.room_links to authenticated;
grant select on public.capture_frames to authenticated;
grant select on public.resumable_uploads, public.processing_jobs, public.panorama_assets to authenticated;
