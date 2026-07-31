-- Append-only manager activity history for shared dashboard changes. No PMB data is stored here.
create table if not exists public.dashboard_activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  area text not null check (char_length(area) <= 48),
  action text not null check (char_length(action) <= 48),
  role text not null check (char_length(role) <= 30),
  revision bigint not null default 0 check (revision >= 0),
  summary text not null default '' check (char_length(summary) <= 240)
);

alter table public.dashboard_activity_log enable row level security;
revoke all on table public.dashboard_activity_log from anon, authenticated;
grant select, insert on table public.dashboard_activity_log to service_role;

create index if not exists dashboard_activity_log_occurred_at_idx
  on public.dashboard_activity_log (occurred_at desc);
