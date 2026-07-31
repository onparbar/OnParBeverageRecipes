-- One server-owned document for configuration that must be consistent across
-- the service computer and remote dashboard sessions. Application writes use
-- revision-checked PATCH requests, so every logical multi-field change is
-- committed to this row atomically.
create table if not exists public.dashboard_shared_state (
  id text primary key,
  revision bigint not null default 0 check (revision >= 0),
  initialized boolean not null default false,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  initialized_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by_role text not null default '',
  constraint dashboard_shared_state_singleton check (id = 'dashboard-config'),
  constraint dashboard_shared_state_initialization_time check (
    (initialized and initialized_at is not null)
    or (not initialized and initialized_at is null)
  )
);

alter table public.dashboard_shared_state enable row level security;

-- Browser credentials must never have direct access. The Next.js API route is
-- the only application entrypoint and authenticates with a server-side secret.
revoke all on table public.dashboard_shared_state from anon, authenticated;
grant select, update on table public.dashboard_shared_state to service_role;

-- This provisions only an empty container. Importing browser data remains an
-- explicit owner action with expectedRevision = 0.
insert into public.dashboard_shared_state (
  id,
  revision,
  initialized,
  data,
  initialized_at,
  updated_by_role
)
values (
  'dashboard-config',
  0,
  false,
  '{}'::jsonb,
  null,
  ''
)
on conflict (id) do nothing;

comment on table public.dashboard_shared_state is
  'Revisioned singleton for shared On Par dashboard pricing, recipes, and product configuration.';
