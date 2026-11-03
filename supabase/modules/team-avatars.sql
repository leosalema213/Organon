-- Apply after the roster in inbox.sql includes avatar_hash.
-- Applied and checked with synthetic rollback fixtures on Organon, 2026-11-03.
-- Authorize only the current profile photo, never other files in a user's private bucket.
begin;
create or replace function organon_private.can_view_team_avatar(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid() and deleted_at is null and not is_anonymous and (banned_until is null or banned_until<now())) and exists (
  select 1 from public.organon_profiles p where p.avatar_hash is not null
   and object_name=p.user_id::text||'/'||p.avatar_hash and (
    p.user_id=auth.uid()
    or exists(select 1 from public.organizations o join public.organon_team_members target on target.org_id=o.id
      where o.owner_id=auth.uid() and target.user_id=p.user_id)
    or exists(select 1 from public.organon_team_members viewer join public.organizations o on o.id=viewer.org_id
      where viewer.user_id=auth.uid() and viewer.status='accepted' and (
       o.owner_id=p.user_id or exists(select 1 from public.organon_team_members target
        where target.org_id=o.id and target.user_id=p.user_id and target.status='accepted')
      ))
   )
 );
$$;
revoke all on function organon_private.can_view_team_avatar(text) from public,anon;
grant execute on function organon_private.can_view_team_avatar(text) to authenticated;
drop policy if exists teams_avatar_read on storage.objects;
create policy teams_avatar_read on storage.objects for select to authenticated
 using(bucket_id='organon-assets' and organon_private.can_view_team_avatar(name));
commit;
