create table if not exists email_tracking (
  id            uuid primary key default gen_random_uuid(),
  token         uuid unique not null default gen_random_uuid(),
  lead_id       uuid references leads(id) on delete cascade,
  user_id       uuid references profiles(id) on delete set null,
  to_email      text not null,
  subject       text,
  first_opened_at  timestamptz,
  last_opened_at   timestamptz,
  opened_count  int not null default 0,
  sent_at       timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table email_tracking enable row level security;

-- Authenticated users can read tracking records
create policy "authenticated users can view email tracking"
  on email_tracking for select
  to authenticated
  using (true);

-- Service role handles inserts and updates (tracking pixel route uses service client)
