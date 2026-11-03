-- Apply centrally after teams.sql. Domain shapes preserve the source application's columns.
begin;
create table public.financeiro_types (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 name text not null check(char_length(name) between 1 and 200),
 normalized_name text generated always as (lower(regexp_replace(btrim(normalize(name,NFKC)),'\s+',' ','g'))) stored,
 created_by uuid references auth.users(id), source_created_by uuid, created_at timestamptz default now(),
 revision bigint not null default 1, updated_at timestamptz not null default now(), unique(org_id,normalized_name)
);
create table public.financeiro_entries (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 description text not null default '', value numeric not null default 0 check(value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 type_id uuid references public.financeiro_types(id), entry_type text not null check(entry_type in ('gasto','entrada','projetado')),
 entry_date date not null, count_for_mei boolean not null default false,
 created_by uuid references auth.users(id), source_created_by uuid, created_at timestamptz default now(),
 revision bigint not null default 1, updated_at timestamptz not null default now()
);
create index financeiro_entries_org_date on public.financeiro_entries(org_id,entry_date,id);
create index financeiro_entries_type on public.financeiro_entries(type_id);
create table public.financeiro_settings (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 owner_id uuid not null references auth.users(id), year integer not null check(year between 2001 and 9999),
 mei_limit numeric not null default 0 check(mei_limit>=0 and mei_limit not in ('NaN'::numeric,'Infinity'::numeric)),
 created_by uuid references auth.users(id), source_created_by uuid, created_at timestamptz default now(),
 revision bigint not null default 1, updated_at timestamptz not null default now(), unique(org_id,owner_id,year)
);
create table organon_private.financial_requests (
 org_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 request_id uuid not null, action text not null, payload jsonb not null, result jsonb not null,
 primary key(org_id,user_id,request_id)
);
revoke all on organon_private.financial_requests from public,anon,authenticated;
alter table public.financeiro_types enable row level security;
alter table public.financeiro_entries enable row level security;
alter table public.financeiro_settings enable row level security;
revoke all on public.financeiro_types,public.financeiro_entries,public.financeiro_settings from public,anon,authenticated;
grant select on public.financeiro_types,public.financeiro_entries,public.financeiro_settings to authenticated;
create policy financeiro_types_read on public.financeiro_types for select to authenticated using(public.organon_can_access_resource(org_id,'financeiro'));
create policy financeiro_entries_read on public.financeiro_entries for select to authenticated using(public.organon_can_access_resource(org_id,'financeiro'));
-- All writes use the checked Financeiro/MEI RPCs, including owner writes.
create policy financeiro_settings_owner on public.financeiro_settings for select to authenticated using(owner_id=auth.uid() and organon_private.owner(org_id));

create function organon_private.financial_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if new.id<>old.id or new.org_id<>old.org_id or new.created_by is distinct from old.created_by or new.source_created_by is distinct from old.source_created_by then raise exception 'Immutable financial identity'; end if;
  new.revision:=old.revision+1;
 else
  if auth.uid() is not null then new.created_by:=auth.uid(); end if;
  new.revision:=1;
 end if;
 if TG_TABLE_NAME='financeiro_entries' then
  if new.type_id is not null and not exists(select 1 from public.financeiro_types where id=new.type_id and org_id=new.org_id) then raise exception 'Category belongs to another space'; end if;
 end if;
 new.updated_at:=now(); return new;
end; $$;
revoke all on function organon_private.financial_revision() from public,anon,authenticated;
create trigger financeiro_types_revision before insert or update on public.financeiro_types for each row execute function organon_private.financial_revision();
create trigger financeiro_entries_revision before insert or update on public.financeiro_entries for each row execute function organon_private.financial_revision();
create trigger financeiro_settings_revision before insert or update on public.financeiro_settings for each row execute function organon_private.financial_revision();

create function public.financeiro_snapshot(p_org_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not public.organon_can_access_resource(p_org_id,'financeiro') then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'entries',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'orgId',e.org_id,'description',e.description,'value',e.value::text,'typeId',e.type_id,'entryType',e.entry_type,'entryDate',e.entry_date,'countForMei',e.count_for_mei,'createdBy',e.created_by,'sourceCreatedBy',e.source_created_by,'createdAt',e.created_at,'revision',e.revision) order by e.entry_date desc,e.created_at desc,e.id),'[]'::jsonb) from public.financeiro_entries e where e.org_id=p_org_id),
  'types',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'orgId',t.org_id,'createdBy',t.created_by) order by t.name,t.id),'[]'::jsonb) from public.financeiro_types t where t.org_id=p_org_id),
  'canWrite',public.organon_can_access_resource(p_org_id,'financeiro',null,true));
end; $$;
revoke all on function public.financeiro_snapshot(uuid) from public,anon;
grant execute on function public.financeiro_snapshot(uuid) to authenticated;

create function organon_private.financial_mutate(p_org_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); e public.financeiro_entries; t public.financeiro_types; item jsonb; previous organon_private.financial_requests;
 v_request_id uuid; result jsonb; ids jsonb:='[]'; normalized text; target_date date; target_last integer;
begin
 if u is null then raise exception 'Forbidden' using errcode='42501'; end if;
 -- Serialize writes with team grant/revocation operations, then check the current permission.
 perform 1 from public.organizations where id=p_org_id for update;
 if not found or not public.organon_can_access_resource(p_org_id,'financeiro',null,true) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_action is null or p_action not in ('createEntry','updateEntry','deleteEntry','createType','duplicateEntries') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid financial action'; end if;
 perform pg_advisory_xact_lock(hashtextextended('financeiro:'||p_org_id::text,0));
 if p_action in ('createEntry','duplicateEntries') then
  v_request_id:=(p_payload->>'requestId')::uuid;
  if v_request_id is null then raise exception 'Request identity required'; end if;
  select * into previous from organon_private.financial_requests r where r.org_id=p_org_id and r.user_id=u and r.request_id=v_request_id;
  if found then
   if previous.action<>p_action or previous.payload<>p_payload then raise exception 'Request identity reused with different content'; end if;
   return previous.result;
  end if;
 end if;
 if p_action='createType' then
  if coalesce(char_length(btrim(p_payload->>'name')),0) not between 1 and 200 then raise exception 'Invalid category name'; end if;
  normalized:=lower(regexp_replace(btrim(normalize(p_payload->>'name',NFKC)),'\s+',' ','g'));
  select * into t from public.financeiro_types where org_id=p_org_id and normalized_name=normalized;
  if not found then insert into public.financeiro_types(org_id,name,created_by) values(p_org_id,regexp_replace(btrim(normalize(p_payload->>'name',NFKC)),'\s+',' ','g'),u) returning * into t; end if;
  return jsonb_build_object('ok',true,'type',jsonb_build_object('id',t.id,'name',t.name,'orgId',t.org_id));
 elsif p_action in ('createEntry','updateEntry') then
  if coalesce(char_length(btrim(p_payload->>'description')),0) not between 1 and 10000 or coalesce(p_payload->>'entryType','') not in ('entrada','gasto','projetado')
    or coalesce(p_payload->>'value','') !~ '^-?[0-9]+(\.[0-9]+)?$' or char_length(p_payload->>'value')>200 or jsonb_typeof(p_payload->'countForMei') is distinct from 'boolean'
    or coalesce(p_payload->>'entryDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid financial entry'; end if;
  if nullif(p_payload->>'typeId','') is not null and not exists(select 1 from public.financeiro_types where id=(p_payload->>'typeId')::uuid and org_id=p_org_id) then raise exception 'Category belongs to another space'; end if;
  if p_action='createEntry' then
   insert into public.financeiro_entries(org_id,description,value,type_id,entry_type,entry_date,count_for_mei,created_by)
   values(p_org_id,p_payload->>'description',(p_payload->>'value')::numeric,nullif(p_payload->>'typeId','')::uuid,p_payload->>'entryType',(p_payload->>'entryDate')::date,(p_payload->>'countForMei')::boolean,u) returning * into e;
  else
   select * into e from public.financeiro_entries where id=(p_payload->>'id')::uuid and org_id=p_org_id for update;
   if not found or e.revision is distinct from (p_payload->>'expectedRevision')::bigint then return jsonb_build_object('conflict',true); end if;
   update public.financeiro_entries set description=p_payload->>'description',value=(p_payload->>'value')::numeric,type_id=nullif(p_payload->>'typeId','')::uuid,entry_type=p_payload->>'entryType',entry_date=(p_payload->>'entryDate')::date,count_for_mei=(p_payload->>'countForMei')::boolean where id=e.id returning * into e;
  end if;
  result:=jsonb_build_object('ok',true,'id',e.id,'revision',e.revision);
 elsif p_action='deleteEntry' then
  select * into e from public.financeiro_entries where id=(p_payload->>'id')::uuid and org_id=p_org_id for update;
  if not found or e.revision is distinct from (p_payload->>'expectedRevision')::bigint then return jsonb_build_object('conflict',true); end if;
  delete from public.financeiro_entries where id=e.id; result:=jsonb_build_object('ok',true,'id',e.id);
 else
  if jsonb_typeof(p_payload->'entries') is distinct from 'array' or jsonb_array_length(p_payload->'entries') not between 1 and 1000 or coalesce(p_payload->>'targetMonth','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid duplicate request'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_payload->'entries') x)<>jsonb_array_length(p_payload->'entries') then raise exception 'Duplicate selection'; end if;
  target_date:=((p_payload->>'targetMonth')||'-01')::date;
  target_last:=extract(day from target_date+interval '1 month'-interval '1 day');
  -- Validate all revisions before any insertion, including callers bypassing the main adapter.
  for item in select * from jsonb_array_elements(p_payload->'entries') loop
   select * into e from public.financeiro_entries where id=(item->>'id')::uuid and org_id=p_org_id for update;
   if not found or e.revision is distinct from (item->>'expectedRevision')::bigint then return jsonb_build_object('conflict',true); end if;
  end loop;
  for item in select * from jsonb_array_elements(p_payload->'entries') loop
   select * into e from public.financeiro_entries where id=(item->>'id')::uuid and org_id=p_org_id;
   insert into public.financeiro_entries(org_id,description,value,type_id,entry_type,entry_date,count_for_mei,created_by)
   values(p_org_id,e.description,e.value,e.type_id,e.entry_type,target_date+(least(extract(day from e.entry_date)::int,target_last)-1),e.count_for_mei,u) returning * into e;
   ids:=ids||jsonb_build_array(e.id);
  end loop;
  result:=jsonb_build_object('ok',true,'ids',ids);
 end if;
 if v_request_id is not null then insert into organon_private.financial_requests values(p_org_id,u,v_request_id,p_action,p_payload,result); end if;
 return result;
end; $$;
revoke all on function organon_private.financial_mutate(uuid,text,jsonb) from public,anon;
grant execute on function organon_private.financial_mutate(uuid,text,jsonb) to authenticated;
create function public.financeiro_mutate(p_org_id uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select organon_private.financial_mutate(p_org_id,p_action,p_payload); $$;
revoke all on function public.financeiro_mutate(uuid,text,jsonb) from public,anon;
grant execute on function public.financeiro_mutate(uuid,text,jsonb) to authenticated;
create function organon_private.financeiro_notify() returns trigger language plpgsql security definer set search_path='' as $$
declare organization uuid:=coalesce(NEW.org_id,OLD.org_id);
begin
 perform realtime.send(jsonb_build_object('module','financeiro','orgId',organization),'changed','financeiro:'||organization::text,true);
 return null;
end; $$;
revoke all on function organon_private.financeiro_notify() from public,anon,authenticated;
create trigger financeiro_entries_notify after insert or update or delete on public.financeiro_entries for each row execute function organon_private.financeiro_notify();
create trigger financeiro_types_notify after insert or update or delete on public.financeiro_types for each row execute function organon_private.financeiro_notify();
create policy organon_financeiro_broadcast_read on realtime.messages for select to authenticated using(
 extension='broadcast' and exists(select 1 from public.organizations o where realtime.topic()='financeiro:'||o.id::text and public.organon_can_access_resource(o.id,'financeiro'))
);
commit;
