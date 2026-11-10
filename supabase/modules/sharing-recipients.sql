-- Apply after sharing.sql. Existing grants remain unchanged until an explicit sharing action.
begin;
create or replace function organon_private.can_access(p_org_id uuid,p_module text,p_resource_id uuid,p_write boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and p_module in ('notebooks','books','kanban','financeiro','mei') and exists(
  select 1 from public.organizations o where o.id=p_org_id and (o.owner_id=auth.uid() or
   (p_module<>'mei' and exists(select 1 from public.organon_team_members m where m.org_id=o.id and m.user_id=auth.uid() and m.status='accepted' and (
    exists(select 1 from public.organon_shared_resources r where r.org_id=o.id and r.module=p_module and r.resource_id=p_resource_id and r.published_by=auth.uid()) or
    (((m.grants->p_module->>'mode'='all' and not coalesce((m.grants->p_module->'excludedIds') ? p_resource_id::text,false)) or (p_module in ('notebooks','books','kanban') and p_resource_id is not null and m.grants->p_module->>'mode'='selected' and (m.grants->p_module->'ids') ? p_resource_id::text)) and (not p_write or m.grants->p_module->>'write'='true'))
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
  if v ? 'excludedIds' then
   if k not in ('notebooks','books') or v->>'mode'<>'all' or jsonb_typeof(v->'excludedIds') is distinct from 'array' or jsonb_array_length(v->'excludedIds')>500 then return false; end if;
   perform x::uuid from jsonb_array_elements_text(v->'excludedIds') x;
  end if;
  if v->>'mode'='selected' then
   if k not in ('notebooks','books','kanban') or jsonb_array_length(v->'ids') not between 1 and 500 then return false; end if;
   perform x::uuid from jsonb_array_elements_text(v->'ids') x;
  elsif jsonb_array_length(v->'ids')<>0 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function organon_private.validate_grants(jsonb) from public,anon,authenticated;

create or replace function organon_private.shared_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record; owner_id uuid; author_member uuid; actor uuid:=auth.uid();
begin
 select o.owner_id into owner_id from public.organizations o where o.id=new.org_id;
 select id into author_member from public.organon_team_members where org_id=new.org_id and user_id=actor and status='accepted';
 for recipient in
  select owner_id as user_id,author_member as member_id where owner_id<>actor
  union all
  select m.user_id,m.id from public.organon_team_members m where m.org_id=new.org_id and m.status='accepted' and m.user_id<>actor and m.user_id<>owner_id
   and (m.user_id=new.published_by or (m.grants->new.module->>'mode'='all' and not coalesce((m.grants->new.module->'excludedIds') ? new.resource_id::text,false)) or (m.grants->new.module->>'mode'='selected' and (m.grants->new.module->'ids') ? new.resource_id::text))
 loop
  if recipient.member_id is not null then insert into public.organon_team_notifications(user_id,member_id,kind) values(recipient.user_id,recipient.member_id,'shared_'||new.module); end if;
 end loop;
 return null;
end; $$;
revoke all on function organon_private.shared_notice() from public,anon,authenticated;
drop trigger if exists teams_shared_notice on public.organon_shared_resources;
create trigger teams_shared_notice after insert or update on public.organon_shared_resources for each row execute function organon_private.shared_notice();

create or replace function organon_private.share_recipients(p_org uuid,p_module text,p_resource uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); owner_id uuid; r public.organon_shared_resources; members jsonb;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not is_anonymous and (banned_until is null or banned_until<now())) then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_module is null or p_module not in ('books','notebooks') or p_resource is null then raise exception 'Invalid resource' using errcode='42501'; end if;
 select o.owner_id into owner_id from public.organizations o where o.id=p_org;
 if owner_id is null or not (owner_id=u or exists(select 1 from public.organon_team_members m where m.org_id=p_org and m.user_id=u and m.status='accepted')) then raise exception 'Membership required' using errcode='42501'; end if;
 select * into r from public.organon_shared_resources where org_id=p_org and module=p_module and resource_id=p_resource;
 if r.resource_id is not null and r.published_by<>u then raise exception 'Publisher required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(s order by s.user_id),'[]'::jsonb) into members from (
  select m.user_id,p.name,p.nickname,false as fixed,
   case when r.resource_id is null then true else coalesce(
    (m.grants->p_module->>'mode'='all' and not coalesce((m.grants->p_module->'excludedIds') ? p_resource::text,false)) or
    (m.grants->p_module->>'mode'='selected' and (m.grants->p_module->'ids') ? p_resource::text),false) end as selected
  from public.organon_team_members m left join public.organon_profiles p on p.user_id=m.user_id
  where m.org_id=p_org and m.status='accepted' and m.user_id<>u and m.user_id<>owner_id
  union all select o.owner_id,p.name,p.nickname,true,true from public.organizations o left join public.organon_profiles p on p.user_id=o.owner_id where o.id=p_org and o.owner_id<>u
 ) s;
 return jsonb_build_object('members',members,'token',md5(members::text),'revision',coalesce(r.revision,0));
end; $$;
revoke all on function organon_private.share_recipients(uuid,text,uuid) from public,anon;
grant execute on function organon_private.share_recipients(uuid,text,uuid) to authenticated;

create or replace function organon_private.sharing_recipients(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=(p_payload->>'orgId')::uuid; n text:=p_payload->>'module'; target uuid:=(p_payload->>'resourceId')::uuid;
 audience jsonb; recipients jsonb; m record; g jsonb; ids jsonb; exclusions jsonb; selected boolean; old_row public.organon_shared_resources; result jsonb;
begin
 -- Organization first: serialize with existing invitation/permission/publication RPCs.
 perform 1 from public.organizations where id=o for update;
 audience:=organon_private.share_recipients(o,n,target);
 if p_action='shareRecipients' then return audience; end if;
 if p_action is null or p_action not in ('publish','setRecipients') then raise exception 'Invalid sharing action'; end if;
 if p_action='setRecipients' and not (p_payload ? 'recipientIds') then raise exception 'Recipients required'; end if;
 select * into old_row from public.organon_shared_resources where org_id=o and module=n and resource_id=target for update;
 if coalesce(old_row.revision,0) is distinct from (p_payload->>'revision')::integer then raise exception 'Revision conflict' using errcode='PT409'; end if;
 if p_action='setRecipients' and old_row.resource_id is null then raise exception 'Missing publication'; end if;
 -- Old clients: first publication goes to current members, updates preserve the existing audience.
 if p_payload ? 'recipientIds' then
  recipients:=p_payload->'recipientIds';
  if jsonb_typeof(recipients) is distinct from 'array' or jsonb_array_length(recipients)>500 then raise exception 'Invalid recipients'; end if;
  if (p_payload->>'audienceToken') is distinct from (audience->>'token') then raise exception 'Audience changed' using errcode='PT409'; end if;
  if exists(select 1 from jsonb_array_elements_text(recipients) x where not exists(select 1 from jsonb_array_elements(audience->'members') a where a->>'user_id'=x)) then raise exception 'Invalid recipient' using errcode='42501'; end if;
 elsif old_row.resource_id is null then
  select coalesce(jsonb_agg(a->'user_id'),'[]'::jsonb) into recipients from jsonb_array_elements(audience->'members') a;
 end if;
 if recipients is not null then
  for m in select * from public.organon_team_members where org_id=o and status='accepted' and user_id<>auth.uid() for update loop
   g:=coalesce(m.grants->n,'{"mode":"none","ids":[],"write":false}'::jsonb);
   selected:=recipients ? m.user_id::text;
   if g->>'mode'='all' then
    select coalesce(jsonb_agg(x),'[]'::jsonb) into exclusions from jsonb_array_elements_text(coalesce(g->'excludedIds','[]'::jsonb)) x where x<>target::text;
    if not selected then exclusions:=exclusions||jsonb_build_array(target); end if;
    g:=g||jsonb_build_object('excludedIds',exclusions);
   else
    select coalesce(jsonb_agg(x),'[]'::jsonb) into ids from jsonb_array_elements_text(coalesce(g->'ids','[]'::jsonb)) x where x<>target::text;
    if selected then ids:=ids||jsonb_build_array(target); end if;
    g:=g||jsonb_build_object('mode',case when jsonb_array_length(ids)>0 then 'selected' else 'none' end,'ids',ids,'write',coalesce((g->>'write')::boolean,false) and jsonb_array_length(ids)>0);
   end if;
   if not organon_private.validate_grants(jsonb_build_object(n,g)) then raise exception 'Permission limit exceeded'; end if;
   if g is distinct from m.grants->n then
    update public.organon_team_members set grants=grants||jsonb_build_object(n,g),revision=revision+1 where id=m.id;
    insert into public.organon_team_notifications(user_id,member_id,kind) values(m.user_id,m.id,'permissions');
   end if;
  end loop;
 end if;
 if p_action='publish' then return organon_private.sharing('publish',p_payload); end if;
 update public.organon_shared_resources set revision=revision+1 where org_id=o and module=n and resource_id=target returning to_jsonb(organon_shared_resources.*) into result;
 return result;
end; $$;
revoke all on function organon_private.sharing_recipients(text,jsonb) from public,anon;
grant execute on function organon_private.sharing_recipients(text,jsonb) to authenticated;

create or replace function public.organon_teams(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select case when p_action in ('inbox','readAll','deleteNotice','deleteAllNotices','roster') then organon_private.inbox(p_action,p_payload)
 when p_action in ('publish','setRecipients','shareRecipients') then organon_private.sharing_recipients(p_action,p_payload)
 when p_action='unpublish' then organon_private.sharing(p_action,p_payload)
 else organon_private.teams(p_action,p_payload) end;
$$;
revoke all on function public.organon_teams(text,jsonb) from public,anon;
grant execute on function public.organon_teams(text,jsonb) to authenticated;
commit;
