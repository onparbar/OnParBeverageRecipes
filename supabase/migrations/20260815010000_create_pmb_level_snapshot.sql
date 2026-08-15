create table if not exists public.pmb_level_snapshot (
  id text primary key,
  data jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint pmb_level_snapshot_singleton check (id = 'current')
);

alter table public.pmb_level_snapshot enable row level security;
revoke all on table public.pmb_level_snapshot from anon, authenticated;

insert into public.pmb_level_snapshot (id, data)
values ('current', null)
on conflict (id) do nothing;
