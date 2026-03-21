-- Usage records: per-call token usage tracked per user per device
create table public.usage_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  device_id     text not null,
  model         text not null,
  project       text,
  input_tokens  int default 0,
  output_tokens int default 0,
  cost_usd      numeric(10,6) default 0,
  recorded_at   timestamptz not null,
  created_at    timestamptz default now()
);

-- RLS: users can only access their own data
alter table public.usage_records enable row level security;

create policy "users can select own records"
  on public.usage_records for select
  using (auth.uid() = user_id);

create policy "users can insert own records"
  on public.usage_records for insert
  with check (auth.uid() = user_id);

-- Indexes for common query patterns
create index idx_usage_user_time
  on public.usage_records (user_id, recorded_at desc);

-- Unique constraint for backfill deduplication (device_id + recorded_at per user)
create unique index idx_usage_dedup
  on public.usage_records (user_id, device_id, recorded_at);
