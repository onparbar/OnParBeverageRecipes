-- Durable keg backup counts, pars, on-deck choices, cooler setting, and par recommendations.
-- Provisioning never imports browser data; that explicit first import can only be run at the service computer.
create table if not exists public.keg_par_agent_shared_state (
  id text primary key,
  revision bigint not null default 0 check (revision >= 0),
  initialized boolean not null default false,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  initialized_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by_role text not null default '',
  constraint keg_par_agent_shared_state_singleton check (id = 'keg-par-agent'),
  constraint keg_par_agent_shared_state_initialization_time check (
    (initialized and initialized_at is not null)
    or (not initialized and initialized_at is null)
  )
);

alter table public.keg_par_agent_shared_state enable row level security;
revoke all on table public.keg_par_agent_shared_state from anon, authenticated;
grant select, update on table public.keg_par_agent_shared_state to service_role;

insert into public.keg_par_agent_shared_state (id, revision, initialized, data, initialized_at, updated_by_role)
values ('keg-par-agent', 0, false, '{}'::jsonb, null, '')
on conflict (id) do nothing;

comment on table public.keg_par_agent_shared_state is
  'Revisioned singleton for shared On Par keg backups, pars, on-deck choices, cooler settings, and par recommendations.';
