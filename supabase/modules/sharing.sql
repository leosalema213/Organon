-- After teams.sql and inbox.sql. Applied on Organon and validated with synthetic rollback fixtures.
begin;
alter table public.organon_shared_resources add column if not exists published_by uuid references auth.users(id);
update public.organon_shared_resources r set published_by=o.owner_id from public.organizations o where r.org_id=o.id and r.published_by is null;
alter table public.organon_shared_resources alter column published_by set not null;
create index if not exists shared_resources_publisher on public.organon_shared_resources(published_by);

create or replace function organon_private.can_access(p_org_id uuid,p_module text,p_resource_id uuid,p_write boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and p_module in ('notebooks','books','kanban','financeiro','mei') and exists(
  select 1 from public.organizations o where o.id=p_org_id and (o.owner_id=auth.uid() or
   (p_module<>'mei' and exists(select 1 from public.organon_team_members m where m.org_id=o.id and m.user_id=auth.uid() and m.status='accepted' and (
    exists(select 1 from public.organon_shared_resources r where r.org_id=o.id and r.module=p_module and r.resource_id=p_resource_id and r.published_by=auth.uid()) or
    ((m.grants->p_module->>'mode'='all' or (p_module in ('notebooks','books','kanban') and p_resource_id is not null and m.grants->p_module->>'mode'='selected' and (m.grants->p_module->'ids') ? p_resource_id::text)) and (not p_write or m.grants->p_module->>'write'='true'))
   )))
  )
 );
$$;
revoke all on function organon_private.can_access(uuid,text,uuid,boolean) from public,anon;
grant execute on function organon_private.can_access(uuid,text,uuid,boolean) to authenticated;

create or replace function organon_private.validate_grants(g jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if g is null or jsonb_typeof(g)<>'object' then return false; end if;
 for k,v in select * from jsonb_each(g) loop
  if k not in ('notebooks','books','kanban','financeiro') or jsonb_typeof(v)<>'object'
   or coalesce(v->>'mode','') not in ('none','all','selected') or jsonb_typeof(v->'write') is distinct from 'boolean'
   or jsonb_typeof(v->'ids') is distinct from 'array' then return false; end if;
  if v->>'mode'='selected' then
   if k not in ('notebooks','books','kanban') or jsonb_array_length(v->'ids') not between 1 and 500 then return false; end if;
   perform x::uuid from jsonb_array_elements_text(v->'ids') x;
  elsif jsonb_array_length(v->'ids')<>0 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function organon_private.validate_grants(jsonb) from public,anon,authenticated;

create or replace function organon_private.can_publish(p_org uuid,p_module text,p_resource uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and p_module in ('notebooks','books') and p_resource is not null
 and exists(select 1 from public.organizations o where o.id=p_org and (o.owner_id=auth.uid() or exists(select 1 from public.organon_team_members m where m.org_id=o.id and m.user_id=auth.uid() and m.status='accepted')))
 and not exists(select 1 from public.organon_shared_resources r where r.org_id=p_org and r.module=p_module and r.resource_id=p_resource and r.published_by<>auth.uid());
$$;
revoke all on function organon_private.can_publish(uuid,text,uuid) from public,anon;
grant execute on function organon_private.can_publish(uuid,text,uuid) to authenticated;

create or replace function organon_private.can_upload_shared(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_name !~ '^[0-9a-f-]{36}/(books|notebooks)/[0-9a-f-]{36}/[a-f0-9]{64}$' then return false; end if;
 return organon_private.can_publish(split_part(p_name,'/',1)::uuid,split_part(p_name,'/',2),split_part(p_name,'/',3)::uuid);
exception when invalid_text_representation then return false;
end; $$;
revoke all on function organon_private.can_upload_shared(text) from public,anon;
grant execute on function organon_private.can_upload_shared(text) to authenticated;
drop policy if exists teams_storage_insert on storage.objects;
create policy teams_storage_insert on storage.objects for insert to authenticated with check(bucket_id='organon-shared' and organon_private.can_upload_shared(name));
-- Authenticated uploaders can verify their own immutable pending uploads on retry.
drop policy if exists teams_upload_retry_read on storage.objects;
create policy teams_upload_retry_read on storage.objects for select to authenticated using(bucket_id='organon-shared' and owner_id=(select auth.uid())::text and organon_private.can_upload_shared(name));

create or replace function organon_private.sharing(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o uuid:=(p_payload->>'orgId')::uuid; n text:=p_payload->>'module'; target uuid:=(p_payload->>'resourceId')::uuid;
 old_row public.organon_shared_resources; result jsonb; q text;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not is_anonymous and (banned_until is null or banned_until<now())) then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('publish','unpublish') or n is null or n not in ('notebooks','books') or target is null then raise exception 'Invalid sharing action'; end if;
 -- Same lock order as permission changes and the original publication contract.
 perform 1 from public.organizations where id=o for update;
 if not found or not (organon_private.owner(o) or exists(select 1 from public.organon_team_members where org_id=o and user_id=u and status='accepted')) then raise exception 'Membership required' using errcode='42501'; end if;
 select * into old_row from public.organon_shared_resources where org_id=o and module=n and resource_id=target for update;
 if old_row.resource_id is not null and old_row.published_by<>u and not (p_action='unpublish' and organon_private.owner(o)) then raise exception 'Publisher required' using errcode='42501'; end if;
 if coalesce(old_row.revision,0) is distinct from (p_payload->>'revision')::integer then raise exception 'Revision conflict' using errcode='PT409'; end if;
 if p_action='unpublish' then
  delete from public.organon_shared_resources where org_id=o and module=n and resource_id=target; return '{}'::jsonb;
 end if;
 if jsonb_typeof(p_payload->'content') is distinct from 'object' or pg_column_size(p_payload)>8388608 or jsonb_typeof(p_payload->'assets') is distinct from 'array' then raise exception 'Invalid resource'; end if;
 insert into public.organon_shared_resources(org_id,module,resource_id,content,published_by) values(o,n,target,p_payload->'content',u)
 on conflict(org_id,module,resource_id) do update set content=excluded.content,revision=organon_shared_resources.revision+1
 returning to_jsonb(organon_shared_resources.*) into result;
 delete from public.organon_shared_assets where org_id=o and module=n and resource_id=target;
 for q in select jsonb_array_elements_text(p_payload->'assets') loop
  if q !~ ('^'||o::text||'/'||n||'/'||target::text||'/[a-f0-9]{64}$') then raise exception 'Invalid private asset'; end if;
  if not exists(select 1 from storage.objects where bucket_id='organon-shared' and name=q) then raise exception 'Missing asset'; end if;
  insert into public.organon_shared_assets values(o,n,target,q);
 end loop;
 return result;
end; $$;
revoke all on function organon_private.sharing(text,jsonb) from public,anon;
grant execute on function organon_private.sharing(text,jsonb) to authenticated;

create or replace function public.organon_teams(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select case when p_action in ('inbox','readAll','deleteNotice','deleteAllNotices','roster') then organon_private.inbox(p_action,p_payload)
 when p_action in ('publish','unpublish') then organon_private.sharing(p_action,p_payload)
 else organon_private.teams(p_action,p_payload) end;
$$;
revoke all on function public.organon_teams(text,jsonb) from public,anon;
grant execute on function public.organon_teams(text,jsonb) to authenticated;

create or replace function organon_private.shared_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record; owner_id uuid; author_member uuid; actor uuid:=auth.uid();
begin
 select o.owner_id into owner_id from public.organizations o where o.id=new.org_id;
 select id into author_member from public.organon_team_members where org_id=new.org_id and user_id=actor and status='accepted';
 for recipient in
  select owner_id as user_id,author_member as member_id where owner_id<>actor
  union all
  select m.user_id,m.id from public.organon_team_members m where m.org_id=new.org_id and m.status='accepted' and m.user_id<>actor and m.user_id<>owner_id
   and (m.user_id=new.published_by or m.grants->new.module->>'mode'='all' or (m.grants->new.module->>'mode'='selected' and (m.grants->new.module->'ids') ? new.resource_id::text))
 loop
  if recipient.member_id is not null then insert into public.organon_team_notifications(user_id,member_id,kind) values(recipient.user_id,recipient.member_id,'shared_'||new.module); end if;
 end loop;
 return null;
end; $$;
revoke all on function organon_private.shared_notice() from public,anon,authenticated;
drop trigger if exists teams_shared_notice on public.organon_shared_resources;
create trigger teams_shared_notice after insert or update on public.organon_shared_resources for each row execute function organon_private.shared_notice();
commit;
