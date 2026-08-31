create table if not exists public.pmb_data_backup (
  source text primary key,
  data jsonb not null,
  captured_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint pmb_data_backup_source_format check (source ~ '^[a-z0-9][a-z0-9-]*$')
);

alter table public.pmb_data_backup enable row level security;
revoke all on table public.pmb_data_backup from anon, authenticated;

comment on table public.pmb_data_backup is
  'Latest server-only fallback payload for each live Pour My Beer data source.';
