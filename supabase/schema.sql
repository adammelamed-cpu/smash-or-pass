-- SkiBrief schema
-- Run this in your Supabase SQL editor at supabase.com/dashboard

create extension if not exists "pgcrypto";

-- User profiles
create table if not exists profiles (
  id               uuid primary key default gen_random_uuid(),
  phone            text unique not null,        -- 10-digit US number, digits only
  name             text not null,
  home_mountain    text,                        -- resort name from IKON_RESORTS
  departure_city   text,                        -- free-text city/address
  section_prefs    text[] default array['field','road','parking','lifts','trails','avalanche','weather','summary'],
  checkin_time     text default 'evening',      -- 'evening' (7pm prev night) | 'morning' (6:30am)
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Crews (groups of friends)
create table if not exists crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references profiles(id) on delete set null,
  invite_code text unique not null default upper(substr(md5(random()::text), 1, 6)),
  created_at  timestamptz default now()
);

-- Many-to-many profiles <-> crews
create table if not exists crew_members (
  crew_id    uuid references crews(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  primary key (crew_id, profile_id),
  joined_at  timestamptz default now()
);

-- Daily check-in events (one per crew per day)
create table if not exists check_ins (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid references crews(id) on delete cascade,
  sent_by    uuid references profiles(id) on delete set null,
  date       date not null,
  sent_at    timestamptz default now(),
  unique (crew_id, date)
);

-- Individual reactions to a check-in
create table if not exists reactions (
  id              uuid primary key default gen_random_uuid(),
  check_in_id     uuid references check_ins(id) on delete cascade,
  profile_id      uuid references profiles(id) on delete cascade,
  activity        text,               -- 'skiing' | 'lake' | 'golf' | 'home' | null
  note            text,
  reaction_token  text unique not null default encode(gen_random_bytes(12), 'hex'),
  reacted_at      timestamptz,
  unique (check_in_id, profile_id)
);

-- Enable Row Level Security (keep it open for service_role key usage from API)
alter table profiles     enable row level security;
alter table crews        enable row level security;
alter table crew_members enable row level security;
alter table check_ins    enable row level security;
alter table reactions    enable row level security;

-- Service role can do everything (used by API)
create policy "service_role_all" on profiles     for all using (true);
create policy "service_role_all" on crews        for all using (true);
create policy "service_role_all" on crew_members for all using (true);
create policy "service_role_all" on check_ins    for all using (true);
create policy "service_role_all" on reactions    for all using (true);
