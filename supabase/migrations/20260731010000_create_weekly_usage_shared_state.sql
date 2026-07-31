-- Durable Weekly Usage reports and current tap assignments. Provisioning this
-- row never imports browser data; the service computer performs the explicit
-- first import from the dashboard.
create table if not exists public.weekly_usage_shared_state (
  id text primary key,
  revision bigint not null default 0 check (revision >= 0),
  initialized boolean not null default false,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  initialized_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by_role text not null default '',
  constraint weekly_usage_shared_state_singleton check (id = 'weekly-usage'),
  constraint weekly_usage_shared_state_initialization_time check (
    (initialized and initialized_at is not null)
    or (not initialized and initialized_at is null)
  )
);

alter table public.weekly_usage_shared_state enable row level security;

revoke all on table public.weekly_usage_shared_state from anon, authenticated;
grant select, update on table public.weekly_usage_shared_state to service_role;

insert into public.weekly_usage_shared_state (
  id,
  revision,
  initialized,
  data,
  initialized_at,
  updated_by_role
)
values (
  'weekly-usage',
  0,
  false,
  '{}'::jsonb,
  null,
  ''
)
on conflict (id) do nothing;

comment on table public.weekly_usage_shared_state is
  'Revisioned singleton for shared On Par PMB Weekly Usage reports, current taps, and replaced-product history.';
