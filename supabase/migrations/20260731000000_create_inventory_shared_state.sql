-- Durable, revisioned inventory storage shared by signed-in managers. This
-- provisions an empty singleton only; the first import remains an explicit
-- service-computer action in the dashboard.
create table if not exists public.inventory_shared_state (
  id text primary key,
  revision bigint not null default 0 check (revision >= 0),
  initialized boolean not null default false,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  initialized_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by_role text not null default '',
  constraint inventory_shared_state_singleton check (id = 'inventory-state'),
  constraint inventory_shared_state_initialization_time check (
    (initialized and initialized_at is not null)
    or (not initialized and initialized_at is null)
  )
);

alter table public.inventory_shared_state enable row level security;

-- Browsers never receive the server-side key and cannot access this row
-- directly. Authenticated dashboard requests go through the owner-only API.
revoke all on table public.inventory_shared_state from anon, authenticated;
grant select, update on table public.inventory_shared_state to service_role;

insert into public.inventory_shared_state (
  id,
  revision,
  initialized,
  data,
  initialized_at,
  updated_by_role
)
values (
  'inventory-state',
  0,
  false,
  '{}'::jsonb,
  null,
  ''
)
on conflict (id) do nothing;

comment on table public.inventory_shared_state is
  'Revisioned singleton for shared On Par counts, pars, custom inventory items, ordering, and Monday snapshots.';
