-- Run this once in the Supabase SQL Editor for the personal learning app.
create table if not exists public.personal_learning_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.personal_learning_data enable row level security;

grant select, insert, update, delete
  on public.personal_learning_data to authenticated;

drop policy if exists "Owner can read own learning data"
  on public.personal_learning_data;
create policy "Owner can read own learning data"
  on public.personal_learning_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owner can insert own learning data"
  on public.personal_learning_data;
create policy "Owner can insert own learning data"
  on public.personal_learning_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owner can update own learning data"
  on public.personal_learning_data;
create policy "Owner can update own learning data"
  on public.personal_learning_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owner can delete own learning data"
  on public.personal_learning_data;
create policy "Owner can delete own learning data"
  on public.personal_learning_data for delete to authenticated
  using ((select auth.uid()) = user_id);
