-- Liplop · schema inicial (auth + persistência dos dados que hoje vivem no cache)
-- Versão sem SQL dinâmico (cada comando explícito) para rodar sem surpresa.
-- Rodar no SQL editor do projeto Supabase de TESTE. Nada aqui toca produção.

create extension if not exists "uuid-ossp";

-- ── updated_at automático ────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── PERFIL (1:1 com o usuário) ───────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  profile_text  text,
  objectives    text,
  roles         text,
  job_search    jsonb default '{}'::jsonb,
  migrated_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── VAGAS / KANBAN (job-crm-opps-v2) ─────────────────────────────────────────
create table if not exists public.opportunities (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  legacy_id   integer,
  company     text,
  role        text,
  status      text,
  stage       text,
  fit         integer,
  link        text,
  jd_text     text,
  contacts    jsonb default '[]'::jsonb,
  next        text,
  notes       text,
  organic     boolean,
  referred    boolean,
  analysis    text,
  position    integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists opportunities_user_idx on public.opportunities(user_id);
-- chave única (user_id, legacy_id) para o upsert da escrita dupla (Etapa 2)
alter table public.opportunities drop constraint if exists opportunities_user_legacy_uniq;
alter table public.opportunities add  constraint opportunities_user_legacy_uniq unique (user_id, legacy_id);

-- ── CURRÍCULOS GERADOS ───────────────────────────────────────────────────────
create table if not exists public.resumes (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  opportunity_id  uuid references public.opportunities(id) on delete set null,
  title           text,
  content         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists resumes_user_idx on public.resumes(user_id);

-- ── MARCA / CALENDÁRIO / TOM ─────────────────────────────────────────────────
create table if not exists public.marca (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  project     jsonb,
  tone        text,
  calendar    jsonb,
  message     text,
  cal_start   text,
  estrategia  text,
  updated_at  timestamptz not null default now()
);

-- ── ASSINATURA (populada pelo webhook da Stripe) ─────────────────────────────
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text,
  plan                   text,
  price_id               text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on public.subscriptions(stripe_customer_id);

-- ── Triggers de updated_at (explícitos) ──────────────────────────────────────
drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.opportunities;
create trigger set_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.resumes;
create trigger set_updated_at before update on public.resumes
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.marca;
create trigger set_updated_at before update on public.marca
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.subscriptions;
create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ── Cria profile automaticamente no cadastro ─────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.opportunities enable row level security;
alter table public.resumes       enable row level security;
alter table public.marca         enable row level security;
alter table public.subscriptions enable row level security;

-- profiles: dono é a própria linha (id)
drop policy if exists "owner_all" on public.profiles;
create policy "owner_all" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- opportunities / resumes / marca: dono via user_id
drop policy if exists "owner_all" on public.opportunities;
create policy "owner_all" on public.opportunities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "owner_all" on public.resumes;
create policy "owner_all" on public.resumes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "owner_all" on public.marca;
create policy "owner_all" on public.marca
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- subscriptions: usuário só LÊ a própria; escrita fica com o webhook (service_role)
drop policy if exists "owner_read" on public.subscriptions;
create policy "owner_read" on public.subscriptions
  for select using (user_id = auth.uid());
