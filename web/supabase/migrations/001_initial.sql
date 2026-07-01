-- InsiderReach SaaS schema

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  stripe_customer_id text,
  subscription_status text default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_counters (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  rewrite_count int not null default 0,
  pro_count int not null default 0,
  unique (user_id, period_start)
);

create table if not exists public.ai_requests (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('rewrite', 'pro')),
  channel text not null check (channel in ('email', 'linkedin')),
  tokens_est int,
  cached boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_response_cache (
  cache_key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_response_cache_created_at_idx on public.ai_response_cache (created_at);
create index if not exists ai_requests_user_created_idx on public.ai_requests (user_id, created_at desc);
create index if not exists usage_counters_user_period_idx on public.usage_counters (user_id, period_start);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan)
  values (new.id, new.email, 'free')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.usage_counters enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users read own usage"
  on public.usage_counters for select
  using (auth.uid() = user_id);
