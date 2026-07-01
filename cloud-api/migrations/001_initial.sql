-- InsiderReach Cloud API schema (standalone PostgreSQL)

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists usage_counters (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  period_start date not null,
  rewrite_count int not null default 0,
  pro_count int not null default 0,
  unique (user_id, period_start)
);

create table if not exists usage_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  event_type text not null,
  mode text,
  channel text,
  extension_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_response_cache (
  cache_key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists rewrite_requests (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  mode text not null check (mode in ('rewrite', 'rewritePro')),
  channel text not null check (channel in ('email', 'linkedin')),
  cached boolean not null default false,
  extension_version text,
  created_at timestamptz not null default now()
);

create index if not exists usage_counters_user_period_idx on usage_counters (user_id, period_start);
create index if not exists usage_events_user_created_idx on usage_events (user_id, created_at desc);
create index if not exists rewrite_requests_user_created_idx on rewrite_requests (user_id, created_at desc);
create index if not exists ai_response_cache_created_at_idx on ai_response_cache (created_at);
