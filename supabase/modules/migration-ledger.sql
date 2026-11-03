-- Coordinator-only import machinery. No client role may invoke the importer.
begin;
create table public.organon_legacy_profiles (
 id uuid primary key, org_id uuid not null references public.organizations(id), source_project text not null,
 name text not null, source_role text, source_payload jsonb not null, created_at timestamptz
);
alter table public.organon_legacy_profiles enable row level security;
revoke all on public.organon_legacy_profiles from public,anon,authenticated;
grant select on public.organon_legacy_profiles to authenticated;
create policy legacy_profiles_owner on public.organon_legacy_profiles for select to authenticated using(organon_private.owner(org_id));
create table public.organon_legacy_assets (
 id uuid primary key, org_id uuid not null references public.organizations(id), source_project text not null,
 source_bucket text not null, source_name text not null, mime text not null, size integer not null,
 sha256 text not null, archive_path text not null, unique(source_project,source_bucket,source_name)
);
alter table public.organon_legacy_assets enable row level security;
revoke all on public.organon_legacy_assets from public,anon,authenticated;
grant select on public.organon_legacy_assets to authenticated;
create policy legacy_assets_owner on public.organon_legacy_assets for select to authenticated using(organon_private.owner(org_id));
create table organon_private.migration_records (
 source_project text not null, source_table text not null, source_id text not null,
 org_id uuid not null references public.organizations(id), target_table text not null, target_key jsonb not null,
 source_hash text not null, target_hash text not null, source_payload jsonb not null, imported_at timestamptz not null default now(),
 primary key(source_project,source_table,source_id)
);
revoke all on organon_private.migration_records from public,anon,authenticated;
create function organon_private.import_financas_row(p_project text,p_source_table text,p_source_id text,p_org uuid,p_table text,p_key jsonb,p_row jsonb,p_source jsonb,p_hash text)
returns text language plpgsql security invoker set search_path='' as $$
declare existing organon_private.migration_records; current_row jsonb; current_hash text; columns text; selections text;
begin
 if p_table not in ('organizations','organon_legacy_profiles','organon_legacy_assets','financeiro_types','financeiro_entries','financeiro_settings','kanban_boards','kanban_lists','kanban_cards','kanban_tags','kanban_card_tags') then raise exception 'Import table not allowed'; end if;
 if p_hash !~ '^[a-f0-9]{64}$' or p_project is null or p_source_id is null or jsonb_typeof(p_row)<>'object' then raise exception 'Invalid import payload'; end if;
 execute format('select to_jsonb(t) from public.%I t where to_jsonb(t) @> $1',p_table) into current_row using p_key;
 current_hash:=case when current_row is null then null else encode(sha256(convert_to(current_row::text,'UTF8')),'hex') end;
 select * into existing from organon_private.migration_records where source_project=p_project and source_table=p_source_table and source_id=p_source_id;
 if found then
  if existing.source_hash<>p_hash or existing.target_table<>p_table or existing.target_key<>p_key then raise exception 'Import source changed; explicit reconciliation required: %/%',p_source_table,p_source_id; end if;
  if current_hash is distinct from existing.target_hash then raise exception 'Destination edited or removed; preserve it and reconcile: %/%',p_source_table,p_source_id; end if;
  return 'unchanged';
 end if;
 if current_row is not null then
  if p_table<>'financeiro_types' or not exists(select 1 from organon_private.migration_records where source_project=p_project and org_id=p_org and target_table=p_table and target_key=p_key and target_hash=current_hash) then raise exception 'Unmapped destination identity collision: %/%',p_table,p_key; end if;
 else
  if exists(select 1 from jsonb_object_keys(p_row) k where not exists(select 1 from pg_attribute a where a.attrelid=format('public.%I',p_table)::regclass and a.attname=k and a.attnum>0 and not a.attisdropped and a.attgenerated='')) then raise exception 'Unsupported import column'; end if;
  select string_agg(format('%I',k),',' order by k),string_agg(format('r.%I',k),',' order by k) into columns,selections from jsonb_object_keys(p_row) k;
  execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) r',p_table,columns,selections,p_table) using p_row;
  execute format('select to_jsonb(t) from public.%I t where to_jsonb(t) @> $1',p_table) into current_row using p_key;
  current_hash:=encode(sha256(convert_to(current_row::text,'UTF8')),'hex');
 end if;
 insert into organon_private.migration_records(source_project,source_table,source_id,org_id,target_table,target_key,source_hash,target_hash,source_payload)
 values(p_project,p_source_table,p_source_id,p_org,p_table,p_key,p_hash,current_hash,p_source);
 return case when p_table='financeiro_types' and p_source_id<>p_key->>'id' then 'category_alias' else 'imported' end;
end; $$;
revoke all on function organon_private.import_financas_row(text,text,text,uuid,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('organon-migration-assets','organon-migration-assets',false,5242880,array['image/png','image/jpeg','image/webp']);
create policy organon_migration_asset_owner_read on storage.objects for select to authenticated using(bucket_id='organon-migration-assets' and split_part(name,'/',1)=auth.uid()::text);
-- A disposable uploader gets only these exact paths; no administrative key or personal session.
create table organon_private.migration_assets (
 runner_id uuid not null references auth.users(id), bucket text not null check(bucket in ('organon-kanban','organon-migration-assets')),
 path text not null, source_url text not null, sha256 text not null check(sha256~'^[a-f0-9]{64}$'), size integer not null check(size between 1 and 5242880),
 mime text not null check(mime in ('image/png','image/jpeg','image/webp')), active boolean not null default true,
 primary key(bucket,path)
);
revoke all on organon_private.migration_assets from public,anon,authenticated;
create function organon_private.migration_asset_access(p_bucket text,p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from organon_private.migration_assets where runner_id=auth.uid() and bucket=p_bucket and path=p_path and active);
$$;
revoke all on function organon_private.migration_asset_access(text,text) from public,anon;
grant execute on function organon_private.migration_asset_access(text,text) to authenticated;
create policy organon_migration_runner_insert on storage.objects for insert to authenticated with check(organon_private.migration_asset_access(bucket_id,name));
create policy organon_migration_runner_select on storage.objects for select to authenticated using(organon_private.migration_asset_access(bucket_id,name));
create function organon_private.migration_storage_tasks() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'path',path,'sha256',sha256,'size',size,'mime',mime)),'[]') from organon_private.migration_assets where runner_id=auth.uid() and active;
$$;
revoke all on function organon_private.migration_storage_tasks() from public,anon;
grant execute on function organon_private.migration_storage_tasks() to authenticated;
create function public.organon_migration_storage_tasks() returns jsonb language sql stable security invoker set search_path='' as $$ select organon_private.migration_storage_tasks(); $$;
revoke all on function public.organon_migration_storage_tasks() from public,anon;
grant execute on function public.organon_migration_storage_tasks() to authenticated;
commit;
