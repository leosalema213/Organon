-- Prepared contract; apply centrally after profile.sql. Never copy legacy policies.
begin;
create schema if not exists organon_private;
revoke all on schema organon_private from public, anon, authenticated;
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_at timestamptz not null default now(), owner_id uuid references auth.users(id)
);
alter table public.organizations add column if not exists owner_id uuid references auth.users(id);
do $$ begin
 if exists(select 1 from pg_policies where schemaname='public' and tablename='organizations') then
  raise exception 'Review existing organizations policies before applying teams contract';
 end if;
end $$;
-- Existing organizations remain inaccessible until the coordinator explicitly maps their owner.
create table public.organon_team_members (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending','accepted','declined','revoked')),
  grants jsonb not null default '{}', revision integer not null default 1,
  created_at timestamptz not null default now(), unique(org_id,user_id)
);
create index on public.organon_team_members(user_id,status);
create table public.organon_team_notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references public.organon_team_members(id) on delete cascade,
  kind text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create index on public.organon_team_notifications(user_id,created_at desc);
create table public.organon_shared_resources (
  org_id uuid not null references public.organizations(id) on delete cascade,
  module text not null check(module in ('notebooks','books')), resource_id uuid not null,
  content jsonb not null, revision integer not null default 1,
  primary key(org_id,module,resource_id)
);
create table public.organon_shared_assets (
  org_id uuid not null, module text not null, resource_id uuid not null, object_name text not null unique,
  primary key(org_id,module,resource_id,object_name),
  foreign key(org_id,module,resource_id) references public.organon_shared_resources on delete cascade
);
create function organon_private.can_access(p_org_id uuid,p_module text,p_resource_id uuid,p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and p_module in ('notebooks','books','kanban','financeiro','mei') and exists (
  select 1 from public.organizations o where o.id=p_org_id and
  (o.owner_id=auth.uid() or (p_module <> 'mei' and exists (
    select 1 from public.organon_team_members m where m.org_id=o.id and m.user_id=auth.uid() and m.status='accepted'
    and (m.grants->p_module->>'mode'='all' or
      (p_module in ('notebooks','kanban') and p_resource_id is not null and m.grants->p_module->>'mode'='selected'
       and (m.grants->p_module->'ids') ? p_resource_id::text))
    and (not p_write or m.grants->p_module->>'write'='true')
  )))
 );
$$;
revoke all on function organon_private.can_access(uuid,text,uuid,boolean) from public;
grant usage on schema organon_private to authenticated;
grant execute on function organon_private.can_access(uuid,text,uuid,boolean) to authenticated;
create function public.organon_can_access_resource(p_org_id uuid,p_module text,p_resource_id uuid default null,p_write boolean default false)
returns boolean language sql stable security invoker set search_path = '' as $$
 select organon_private.can_access(p_org_id,p_module,p_resource_id,p_write);
$$;
revoke all on function public.organon_can_access_resource(uuid,text,uuid,boolean) from public,anon;
grant execute on function public.organon_can_access_resource(uuid,text,uuid,boolean) to authenticated;
create function organon_private.owner(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.organizations where id=p_org and owner_id=auth.uid());
$$;
revoke all on function organon_private.owner(uuid) from public;
grant execute on function organon_private.owner(uuid) to authenticated;
alter table public.organizations enable row level security;
alter table public.organon_team_members enable row level security;
alter table public.organon_team_notifications enable row level security;
alter table public.organon_shared_resources enable row level security;
alter table public.organon_shared_assets enable row level security;
revoke all on public.organizations,public.organon_team_members,public.organon_team_notifications,public.organon_shared_resources,public.organon_shared_assets from public,anon,authenticated;
grant select on public.organizations,public.organon_team_members,public.organon_team_notifications,public.organon_shared_resources,public.organon_shared_assets to authenticated;
create policy teams_org_read on public.organizations for select to authenticated using (
 owner_id=auth.uid() or exists(select 1 from public.organon_team_members m where m.org_id=organizations.id and m.user_id=auth.uid() and m.status='accepted')
);
create policy teams_member_read on public.organon_team_members for select to authenticated using(user_id=auth.uid() or organon_private.owner(org_id));
create policy teams_notice_read on public.organon_team_notifications for select to authenticated using(user_id=auth.uid());
create policy teams_resource_read on public.organon_shared_resources for select to authenticated using(public.organon_can_access_resource(org_id,module,resource_id));
create policy teams_asset_read on public.organon_shared_assets for select to authenticated using(public.organon_can_access_resource(org_id,module,resource_id));
create function organon_private.validate_grants(g jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
 if g is null or jsonb_typeof(g)<>'object' then return false; end if;
 for k,v in select * from jsonb_each(g) loop
  if k not in ('notebooks','books','kanban','financeiro') or jsonb_typeof(v)<>'object'
   or coalesce(v->>'mode','') not in ('none','all','selected') or jsonb_typeof(v->'write') is distinct from 'boolean'
   or jsonb_typeof(v->'ids') is distinct from 'array' then return false; end if;
  if v->>'mode'='selected' then
   if k not in ('notebooks','kanban') or jsonb_array_length(v->'ids') not between 1 and 500 then return false; end if;
   perform x::uuid from jsonb_array_elements_text(v->'ids') x;
  elsif jsonb_array_length(v->'ids')<>0 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function organon_private.validate_grants(jsonb) from public;
-- One closed RPC. Writes are atomic, locked and authorized here; no renderer ownership claims.
create function organon_private.teams(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); o uuid; member_row public.organon_team_members; result jsonb; n text; q text; r integer; target uuid;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not is_anonymous and (banned_until is null or banned_until<now())) then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action='search' then
  q:=trim(p_payload->>'query');
  if q is null or char_length(q) not between 3 and 100 then raise exception 'Invalid search'; end if;
  -- Per-account transactional throttle; raw emails never returned. Confirmed exact email only.
  insert into organon_private.team_search_limits(user_id,last_at) values(u,clock_timestamp())
   on conflict(user_id) do update set last_at=excluded.last_at where organon_private.team_search_limits.last_at < clock_timestamp()-interval '2 seconds';
  if not found then raise exception 'Aguarde antes de buscar novamente'; end if;
  select coalesce(jsonb_agg(s),'[]') into result from (
   select a.id,coalesce(p.name,'') as name,coalesce(p.nickname,'') as nickname from auth.users a left join public.organon_profiles p on p.user_id=a.id
   where a.id<>u and a.deleted_at is null and not a.is_anonymous and (a.banned_until is null or a.banned_until<now()) and
    (case when position('@' in q)>0 then a.email_confirmed_at is not null and lower(a.email)=lower(q)
     else position(lower(q) in lower(p.name))>0 or position(lower(q) in lower(p.nickname))>0 end)
   order by p.name nulls last,a.id limit 5
  ) s; return result;
 elsif p_action='list' then
  select coalesce(jsonb_agg(s),'[]') into result from (
   select o.* from public.organizations o where o.owner_id=u or exists(select 1 from public.organon_team_members m where m.org_id=o.id and m.user_id=u and m.status='accepted')
  ) s; return result;
 elsif p_action='create' then
  n:=trim(p_payload->>'name'); if n is null or char_length(n) not between 1 and 100 then raise exception 'Invalid name'; end if;
  insert into public.organizations(name,owner_id) values(n,u) returning to_jsonb(organizations.*) into result; return result;
 elsif p_action='notifications' then
  select coalesce(jsonb_agg(s),'[]') into result from (
   select n.*,m.org_id,m.status,m.revision,m.grants,o.name as org_name from public.organon_team_notifications n
   join public.organon_team_members m on m.id=n.member_id join public.organizations o on o.id=m.org_id
   where n.user_id=u order by n.created_at desc limit 100
  ) s; return result;
 elsif p_action='read' then
  update public.organon_team_notifications set read_at=now() where id=(p_payload->>'id')::uuid and user_id=u; return '{}'::jsonb;
 elsif p_action='respond' then
  select * into member_row from public.organon_team_members where id=(p_payload->>'id')::uuid for update;
  if member_row.user_id is distinct from u or member_row.status<>'pending' then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  if member_row.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Revision conflict' using errcode='PT409'; end if;
  n:=p_payload->>'response'; if n not in ('accepted','declined') or n is null then raise exception 'Invalid response'; end if;
  update public.organon_team_members set status=n,revision=revision+1 where id=member_row.id returning to_jsonb(organon_team_members.*) into result;
  insert into public.organon_team_notifications(user_id,member_id,kind) select owner_id,member_row.id,n from public.organizations where id=member_row.org_id;
  return result;
 end if;
 o:=(p_payload->>'orgId')::uuid;
 if p_action='resources' then
  select coalesce(jsonb_agg(s),'[]') into result from (select * from public.organon_shared_resources where org_id=o and public.organon_can_access_resource(org_id,module,resource_id)) s; return result;
 elsif p_action='editResource' then
  n:=p_payload->>'module'; target:=(p_payload->>'resourceId')::uuid;
  -- Serialize against grant changes as well as competing document edits.
  perform 1 from public.organizations where id=o for update;
  if n is null or n not in ('notebooks','books') or not coalesce(public.organon_can_access_resource(o,n,target,true),false) then raise exception 'Write denied' using errcode='42501'; end if;
  if jsonb_typeof(p_payload->'content') is distinct from 'object' or pg_column_size(p_payload)>8388608 then raise exception 'Invalid resource'; end if;
  update public.organon_shared_resources set content=p_payload->'content',revision=revision+1 where org_id=o and module=n and resource_id=target and revision=(p_payload->>'revision')::integer returning to_jsonb(organon_shared_resources.*) into result;
  if not found then raise exception 'Revision conflict' using errcode='PT409'; end if;
  return result;
 end if;
 -- Lock the organization to serialize owner mutations and invitation replacement.
 perform 1 from public.organizations where id=o and owner_id=u for update;
 if not found then raise exception 'Owner required' using errcode='42501'; end if;
 if p_action='members' then
  select coalesce(jsonb_agg(s),'[]') into result from (
   select m.*,p.name,p.nickname from public.organon_team_members m left join public.organon_profiles p on p.user_id=m.user_id where m.org_id=o order by m.created_at
  ) s; return result;
 elsif p_action='invite' then
  if not organon_private.validate_grants(p_payload->'grants') then raise exception 'Invalid grants'; end if;
  target:=(p_payload->>'recipientId')::uuid;
  if target=u or not exists(select 1 from auth.users where id=target and deleted_at is null and not is_anonymous) then raise exception 'Invalid recipient'; end if;
  insert into public.organon_team_members(org_id,user_id,status,grants) values(o,target,'pending',p_payload->'grants')
   on conflict(org_id,user_id) do update set status='pending',grants=excluded.grants,revision=organon_team_members.revision+1
    where organon_team_members.status in ('declined','revoked') returning * into member_row;
  if not found then raise exception 'Already invited or member'; end if;
  insert into public.organon_team_notifications(user_id,member_id,kind) values(target,member_row.id,'invitation'); return to_jsonb(member_row);
 elsif p_action in ('permissions','revoke') then
  select * into member_row from public.organon_team_members where id=(p_payload->>'id')::uuid and org_id=o for update;
  if member_row.id is null or member_row.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Revision conflict' using errcode='PT409'; end if;
  if p_action='permissions' then
   if member_row.status not in ('pending','accepted') or not organon_private.validate_grants(p_payload->'grants') then raise exception 'Invalid grants'; end if;
   update public.organon_team_members set grants=p_payload->'grants',revision=revision+1 where id=member_row.id returning to_jsonb(organon_team_members.*) into result;
  else
   update public.organon_team_members set status='revoked',grants='{}',revision=revision+1 where id=member_row.id returning to_jsonb(organon_team_members.*) into result;
  end if;
  insert into public.organon_team_notifications(user_id,member_id,kind) values(member_row.user_id,member_row.id,p_action); return result;
 elsif p_action in ('publish','unpublish') then
  n:=p_payload->>'module'; target:=(p_payload->>'resourceId')::uuid;
  if n is null or n not in ('notebooks','books') or target is null then raise exception 'Invalid resource'; end if;
  select revision into r from public.organon_shared_resources where org_id=o and module=n and resource_id=target for update;
  if coalesce(r,0) is distinct from (p_payload->>'revision')::integer then raise exception 'Revision conflict' using errcode='PT409'; end if;
  if p_action='unpublish' then
   delete from public.organon_shared_resources where org_id=o and module=n and resource_id=target; return '{}'::jsonb;
  end if;
  if jsonb_typeof(p_payload->'content') is distinct from 'object' or pg_column_size(p_payload)>8388608 or jsonb_typeof(p_payload->'assets') is distinct from 'array' then raise exception 'Invalid resource'; end if;
  insert into public.organon_shared_resources(org_id,module,resource_id,content) values(o,n,target,p_payload->'content')
   on conflict(org_id,module,resource_id) do update set content=excluded.content,revision=organon_shared_resources.revision+1 returning to_jsonb(organon_shared_resources.*) into result;
  delete from public.organon_shared_assets where org_id=o and module=n and resource_id=target;
  for q in select jsonb_array_elements_text(p_payload->'assets') loop
   if q !~ ('^'||o::text||'/'||n||'/'||target::text||'/[a-f0-9]{64}$') then raise exception 'Invalid private asset'; end if;
   if not exists(select 1 from storage.objects where bucket_id='organon-shared' and name=q) then raise exception 'Missing asset'; end if;
   insert into public.organon_shared_assets values(o,n,target,q);
  end loop; return result;
 end if;
 raise exception 'Unknown teams action';
end; $$;
create table organon_private.team_search_limits(user_id uuid primary key references auth.users on delete cascade,last_at timestamptz not null);
alter table organon_private.team_search_limits enable row level security;
revoke all on organon_private.team_search_limits from public,anon,authenticated;
revoke all on function organon_private.teams(text,jsonb) from public,anon;
grant execute on function organon_private.teams(text,jsonb) to authenticated;
create function public.organon_teams(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select organon_private.teams(p_action,p_payload);$$;
revoke all on function public.organon_teams(text,jsonb) from public,anon;
grant execute on function public.organon_teams(text,jsonb) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values('organon-shared','organon-shared',false,52428800) on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='organon-shared' and public) then raise exception 'Shared bucket must be private'; end if;
end $$;
create policy teams_storage_read on storage.objects for select to authenticated using(bucket_id='organon-shared' and exists(
 select 1 from public.organon_shared_assets a where a.object_name=name and public.organon_can_access_resource(a.org_id,a.module,a.resource_id)
) or (bucket_id='organon-shared' and exists(select 1 from public.organizations o where o.id::text=split_part(storage.objects.name,'/',1) and o.owner_id=auth.uid())));
create policy teams_storage_insert on storage.objects for insert to authenticated with check(bucket_id='organon-shared' and exists(select 1 from public.organizations o where o.id::text=split_part(storage.objects.name,'/',1) and o.owner_id=auth.uid()));
-- No overwrite/delete policy: immutable hashed assets. Central GC removes unreferenced objects.
create function organon_private.teams_signal() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 for recipient in select distinct x from unnest(array[new.user_id,(select owner_id from public.organizations where id=new.org_id)]) x where x is not null loop
  perform realtime.send('{"type":"invalidate"}'::jsonb,'invalidate','teams:user:'||recipient::text,true);
 end loop;
 return new;
end; $$;
revoke all on function organon_private.teams_signal() from public,anon,authenticated;
create trigger teams_changed after insert or update on public.organon_team_members for each row execute function organon_private.teams_signal();
create function organon_private.shared_signal() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; space_id uuid := coalesce(new.org_id,old.org_id);
begin
 for recipient in select owner_id from public.organizations where id=space_id union select user_id from public.organon_team_members where org_id=space_id and status='accepted' loop
  perform realtime.send('{"type":"invalidate"}'::jsonb,'invalidate','teams:user:'||recipient::text,true);
 end loop;
 return null;
end; $$;
revoke all on function organon_private.shared_signal() from public,anon,authenticated;
create trigger teams_shared_changed after insert or update or delete on public.organon_shared_resources for each row execute function organon_private.shared_signal();
create policy teams_private_events on realtime.messages for select to authenticated using(realtime.topic()='teams:user:'||(select auth.uid())::text);
commit;
