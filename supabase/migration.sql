-- NSM Dispatch schema (dispatch_ prefix on wkrtbjvbjebhbcjwurhb)

create table if not exists dispatch_crews (
  id text primary key,
  name text not null,
  market text,
  vehicle text,
  home_lat double precision,
  home_lng double precision,
  color text default '#b04a3c',
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists dispatch_tasks (
  id text primary key,
  jt_task_id text unique,
  jt_job_id text,
  job_name text,
  job_address text,
  lat double precision,
  lng double precision,
  scheduled_date date not null,
  start_time text,
  duration_hrs numeric default 8,
  crew_id text references dispatch_crews(id) on delete set null,
  status text,
  notes text,
  last_synced_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_dispatch_tasks_date on dispatch_tasks(scheduled_date);
create index if not exists idx_dispatch_tasks_crew on dispatch_tasks(crew_id);

create table if not exists dispatch_overrides (
  id uuid primary key default gen_random_uuid(),
  task_id text references dispatch_tasks(id) on delete cascade,
  original_crew_id text,
  new_crew_id text,
  reason text,
  actor text,
  created_at timestamptz default now()
);

create table if not exists dispatch_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  rows_touched integer default 0,
  status text,
  error text
);

-- RLS: enable but allow anon read + service_role full access
alter table dispatch_crews enable row level security;
alter table dispatch_tasks enable row level security;
alter table dispatch_overrides enable row level security;
alter table dispatch_sync_log enable row level security;

do $$ begin
  create policy dispatch_crews_anon_read on dispatch_crews for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy dispatch_tasks_anon_read on dispatch_tasks for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy dispatch_overrides_anon_read on dispatch_overrides for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy dispatch_sync_log_anon_read on dispatch_sync_log for select using (true);
exception when duplicate_object then null; end $$;

-- Enable realtime on the tables the UI subscribes to
alter publication supabase_realtime add table dispatch_tasks;
alter publication supabase_realtime add table dispatch_overrides;

-- Seed NSM crew home bases (market hubs — exact crew roster filled on first sync)
insert into dispatch_crews (id, name, market, home_lat, home_lng, color) values
  ('hub-chicago',     'Chicago Hub',     'Chicago',     41.8781, -87.6298, '#b04a3c'),
  ('hub-milwaukee',   'Milwaukee Hub',   'Milwaukee',   43.0389, -87.9065, '#3c8bb0'),
  ('hub-dallas',      'Dallas Hub',      'Dallas',      32.7767, -96.7970, '#b0823c'),
  ('hub-indianapolis','Indianapolis Hub','Indianapolis',39.7684, -86.1581, '#3cb06f')
on conflict (id) do nothing;
