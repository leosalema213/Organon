-- Account identity is independent of personal study snapshots. No team access is granted yet.
create table public.organon_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  nickname text not null default '' check (char_length(nickname) <= 40),
  avatar_hash text check (avatar_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
alter table public.organon_profiles enable row level security;
revoke all on public.organon_profiles from public, anon;
grant select, insert, update, delete on public.organon_profiles to authenticated;
create policy organon_profile_select on public.organon_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy organon_profile_insert on public.organon_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy organon_profile_update on public.organon_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy organon_profile_delete on public.organon_profiles for delete to authenticated using ((select auth.uid()) = user_id);
