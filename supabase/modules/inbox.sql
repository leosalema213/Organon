-- Additive contract after teams.sql. Applied and verified on Organon, 2026-11-03.
begin;
create or replace function organon_private.inbox(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); o uuid; owner_id uuid; is_owner boolean; result jsonb; invitations jsonb; unread_count bigint;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not is_anonymous and (banned_until is null or banned_until<now())) then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 if p_action='inbox' then
  select count(*) into unread_count from public.organon_team_notifications where user_id=u and read_at is null;
  select coalesce(jsonb_agg(s order by s.created_at desc),'[]'::jsonb) into invitations from (
   select m.id as member_id,m.org_id,m.status,m.revision,m.grants,m.created_at,o.name as org_name
   from public.organon_team_members m join public.organizations o on o.id=m.org_id
   where m.user_id=u and m.status='pending'
  ) s;
  return jsonb_build_object('notifications',organon_private.teams('notifications','{}'::jsonb),'invitations',invitations,'unreadCount',unread_count);
 elsif p_action='readAll' then
  update public.organon_team_notifications set read_at=now() where user_id=u and read_at is null;
  return '{}'::jsonb;
 elsif p_action='deleteNotice' then
  delete from public.organon_team_notifications where user_id=u and id=(p_payload->>'id')::uuid;
  return '{}'::jsonb;
 elsif p_action='deleteAllNotices' then
  -- Deleting receipts never changes membership or a pending invitation.
  delete from public.organon_team_notifications where user_id=u;
  return '{}'::jsonb;
 elsif p_action='roster' then
  o:=(p_payload->>'orgId')::uuid;
  select org.owner_id into owner_id from public.organizations org where org.id=o;
  is_owner:=coalesce(owner_id=u,false);
  if not is_owner and not exists(select 1 from public.organon_team_members where org_id=o and user_id=u and status='accepted') then
   raise exception 'Membership required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(s order by s.created_at),'[]'::jsonb) into result from (
   select m.id,m.user_id,m.status,m.created_at,p.name,p.nickname,p.avatar_hash,'member'::text as role,
    case when is_owner then m.revision else null end as revision,
    case when is_owner then m.grants else null end as grants
   from public.organon_team_members m left join public.organon_profiles p on p.user_id=m.user_id
   where m.org_id=o and (is_owner or m.status='accepted') and m.user_id<>owner_id
   union all
   select org.id,org.owner_id,'accepted',org.created_at,p.name,p.nickname,p.avatar_hash,'owner',null::integer,null::jsonb
   from public.organizations org left join public.organon_profiles p on p.user_id=org.owner_id where org.id=o
  ) s;
  return result;
 end if;
 raise exception 'Invalid inbox action';
end; $$;
revoke all on function organon_private.inbox(text,jsonb) from public,anon;
grant execute on function organon_private.inbox(text,jsonb) to authenticated;
-- Keep the original owner-only members action: main uses it to guard personal catalogs.
create or replace function public.organon_teams(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select case when p_action in ('inbox','readAll','deleteNotice','deleteAllNotices','roster')
  then organon_private.inbox(p_action,p_payload) else organon_private.teams(p_action,p_payload) end;
$$;
revoke all on function public.organon_teams(text,jsonb) from public,anon;
grant execute on function public.organon_teams(text,jsonb) to authenticated;
create or replace function organon_private.inbox_signal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform realtime.send('{"type":"invalidate"}'::jsonb,'invalidate','teams:user:'||coalesce(new.user_id,old.user_id)::text,true);
 return null;
end; $$;
revoke all on function organon_private.inbox_signal() from public,anon,authenticated;
drop trigger if exists teams_inbox_changed on public.organon_team_notifications;
create trigger teams_inbox_changed after insert or update or delete on public.organon_team_notifications
 for each row execute function organon_private.inbox_signal();
commit;
