-- Liplop · schema inicial (auth + persistência dos dados que hoje vivem no cache)
-- Rodar no SQL editor do projeto Supabase de TESTE primeiro. Nada aqui toca produção.
--
-- Princípios:
--  1. Cada tabela tem user_id -> auth.users(id). RLS garante que a pessoa só
--     acessa as próprias linhas (mesmo chamando o banco direto do navegador).
--  2. Estrutura para o que o app consulta (perfil, vagas, currículos, assinatura);
--     jsonb para o que é "blob" (marca/calendário).
--  3. migrated_at em profiles marca quem já teve o cache importado (idempotência).

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensões
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PERFIL (1:1 com o usuário)  [localStorage: liplop-profile, -objectives, -roles, liplop-job-search-v1]
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  profile_text  text,                 -- liplop-profile (LinkedIn/resumo colado)
  objectives    text,                 -- liplop-profile-objectives-v1
  roles         text,                 -- liplop-profile-roles-v1
  job_search    jsonb default '{}'::jsonb,  -- liplop-job-search-v1
  migrated_at   timestamptz,          -- quando o cache deste usuário foi importado
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- VAGAS / KANBAN  [localStorage: job-crm-opps-v2]
create table if not exists public.opportunities (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  legacy_id   integer,               -- id numérico que a vaga tinha no cache (p/ casar referências)
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
  analysis    text,                  -- análise de fit gerada pela IA (hoje vive dentro da vaga)
  position    integer,               -- ordem na coluna do kanban
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists opportunities_user_idx on public.opportunities(user_id);

-- CURRÍCULOS GERADOS  [hoje efêmeros; passam a ser persistidos]
create table if not exists public.resumes (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  opportunity_id  uuid references public.opportunities(id) on delete set null,
  title           text,
  content         text,              -- HTML/texto do currículo adaptado
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists resumes_user_idx on public.resumes(user_id);

-- MARCA / CALENDÁRIO / TOM  [localStorage: liplop-marca-*]
create table if not exists public.marca (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  project     jsonb,   -- liplop-marca-project-v1
  tone        text,    -- liplop-marca-tone-v1
  calendar    jsonb,   -- liplop-marca-calendar-v1
  message     text,    -- liplop-marca-message-v1
  cal_start   text,    -- liplop-marca-cal-start-v1
  estrategia  text,    -- liplop-marca-estrategia-v1
  updated_at  timestamptz not null default now()
);

-- ASSINATURA  [populada pelo webhook da Stripe; liga cliente Stripe <-> usuário]
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text,        -- active, past_due, canceled, ...
  plan                   text,        -- mensal | semestral
  price_id               text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on public.subscriptions(stripe_customer_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['profiles','opportunities','resumes','marca','subscriptions']
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cria profile automaticamente quando um usuário se cadastra
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY: cada usuário só acessa as próprias linhas.
-- subscriptions é só-leitura pro usuário (quem escreve é o webhook via service_role,
-- que ignora RLS).
alter table public.profiles      enable row level security;
alter table public.opportunities enable row level security;
alter table public.resumes       enable row level security;
alter table public.marca         enable row level security;
alter table public.subscriptions enable row level security;

-- profiles / opportunities / resumes / marca: dono pode tudo
do $$
declare tbl text;
begin
  foreach tbl in array array['profiles','opportunities','resumes','marca']
  loop
    execute format('drop policy if exists "owner_all" on public.%I;', tbl);
    execute format($f$
      create policy "owner_all" on public.%I
        for all
        using (%s = auth.uid())
        with check (%s = auth.uid());
    $f$, tbl,
        case when tbl = 'profiles' then 'id' else 'user_id' end,
        case when tbl = 'profiles' then 'id' else 'user_id' end);
  end loop;
end $$;

-- subscriptions: usuário só LÊ a própria; escrita fica com o webhook (service_role)
drop policy if exists "owner_read" on public.subscriptions;
create policy "owner_read" on public.subscriptions
  for select using (user_id = auth.uid());
