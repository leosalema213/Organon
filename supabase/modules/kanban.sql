-- Reviewed/applied centrally AFTER teams.sql. No personal data; preserves legacy IDs/columns.
begin;
create schema if not exists organon_kanban_private;
revoke all on schema organon_kanban_private from public, anon;
grant usage on schema organon_kanban_private to authenticated;
-- Never silently keep an imported permissive source policy alongside these policies.
do $$ begin
 if exists(select 1 from pg_policies where schemaname='public'
  and tablename in('kanban_boards','kanban_lists','kanban_cards','kanban_tags','kanban_card_tags')
  and policyname not in('kanban_boards_read','kanban_lists_read','kanban_cards_read','kanban_tags_read','kanban_card_tags_read')) then
  raise exception 'Review existing Kanban policies before applying this contract';
 end if;
end $$;

create table if not exists public.kanban_boards (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(name) between 1 and 300), bg_type text not null default 'none' check(bg_type in ('none','color','image')),
 bg_color text, bg_image_url text, bg_size text not null default 'cover' check(bg_size in ('cover','repeat')),
 created_by uuid references auth.users(id), source_created_by uuid, created_at timestamptz not null default now(),
 revision bigint not null default 1, updated_at timestamptz not null default now()
);
create table if not exists public.kanban_lists (
 id uuid primary key default gen_random_uuid(), board_id uuid not null references public.kanban_boards(id) on delete cascade,
 name text not null check(length(name) between 1 and 300), color text not null default '#94a3b8', position numeric not null default 0,
 created_at timestamptz not null default now(), revision bigint not null default 1, updated_at timestamptz not null default now()
);
create table if not exists public.kanban_cards (
 id uuid primary key default gen_random_uuid(), list_id uuid not null references public.kanban_lists(id) on delete cascade,
 title text not null check(length(title) between 1 and 1000), description text not null default '' check(length(description)<=200000),
 price numeric(14,2), thumbnail_url text, position numeric not null default 0,
 created_by uuid references auth.users(id), source_created_by uuid, created_at timestamptz not null default now(),
 revision bigint not null default 1, updated_at timestamptz not null default now()
);
create table if not exists public.kanban_tags (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(name) between 1 and 150), color text not null default '#b91c1c', icon text not null default 'Tag',
 created_by uuid references auth.users(id), source_created_by uuid, created_at timestamptz not null default now(),
 revision bigint not null default 1, updated_at timestamptz not null default now()
);
create table if not exists public.kanban_card_tags (
 card_id uuid not null references public.kanban_cards(id) on delete cascade,
 tag_id uuid not null references public.kanban_tags(id) on delete cascade, primary key(card_id,tag_id)
);
-- Additive compatibility for already imported legacy tables. No data rewrites.
alter table public.kanban_boards add column if not exists revision bigint not null default 1;
alter table public.kanban_boards add column if not exists updated_at timestamptz not null default now();
alter table public.kanban_boards add column if not exists source_created_by uuid;
alter table public.kanban_boards add column if not exists bg_size text not null default 'cover';
alter table public.kanban_lists add column if not exists revision bigint not null default 1;
alter table public.kanban_lists add column if not exists updated_at timestamptz not null default now();
alter table public.kanban_cards add column if not exists revision bigint not null default 1;
alter table public.kanban_cards add column if not exists updated_at timestamptz not null default now();
alter table public.kanban_cards add column if not exists source_created_by uuid;
alter table public.kanban_tags add column if not exists revision bigint not null default 1;
alter table public.kanban_tags add column if not exists updated_at timestamptz not null default now();
alter table public.kanban_tags add column if not exists source_created_by uuid;
create index if not exists kanban_boards_org on public.kanban_boards(org_id,created_at,id);
create index if not exists kanban_lists_board on public.kanban_lists(board_id,position,id);
create index if not exists kanban_cards_list on public.kanban_cards(list_id,position,id);
create index if not exists kanban_tags_org on public.kanban_tags(org_id);
create index if not exists kanban_card_tags_tag on public.kanban_card_tags(tag_id);

alter table public.kanban_boards enable row level security;
alter table public.kanban_lists enable row level security;
alter table public.kanban_cards enable row level security;
alter table public.kanban_tags enable row level security;
alter table public.kanban_card_tags enable row level security;
-- Authenticated writes only through the atomic RPC; REST cannot bypass revisions.
revoke all on public.kanban_boards,public.kanban_lists,public.kanban_cards,public.kanban_tags,public.kanban_card_tags from public,anon,authenticated;
grant select on public.kanban_boards,public.kanban_lists,public.kanban_cards,public.kanban_tags,public.kanban_card_tags to authenticated;
drop policy if exists kanban_boards_read on public.kanban_boards;
create policy kanban_boards_read on public.kanban_boards for select to authenticated
 using (public.organon_can_access_resource(org_id,'kanban',id,false));
drop policy if exists kanban_lists_read on public.kanban_lists;
create policy kanban_lists_read on public.kanban_lists for select to authenticated
 using (exists(select 1 from public.kanban_boards b where b.id=kanban_lists.board_id and public.organon_can_access_resource(b.org_id,'kanban',b.id,false)));
drop policy if exists kanban_cards_read on public.kanban_cards;
create policy kanban_cards_read on public.kanban_cards for select to authenticated
 using (exists(select 1 from public.kanban_lists l join public.kanban_boards b on b.id=l.board_id where l.id=kanban_cards.list_id and public.organon_can_access_resource(b.org_id,'kanban',b.id,false)));
drop policy if exists kanban_card_tags_read on public.kanban_card_tags;
create policy kanban_card_tags_read on public.kanban_card_tags for select to authenticated
 using (exists(select 1 from public.kanban_cards c join public.kanban_lists l on l.id=c.list_id join public.kanban_boards b on b.id=l.board_id where c.id=kanban_card_tags.card_id and public.organon_can_access_resource(b.org_id,'kanban',b.id,false)));
drop policy if exists kanban_tags_read on public.kanban_tags;
create policy kanban_tags_read on public.kanban_tags for select to authenticated
 using (public.organon_can_access_resource(org_id,'kanban',null,false) or exists(select 1 from public.kanban_card_tags ct join public.kanban_cards c on c.id=ct.card_id join public.kanban_lists l on l.id=c.list_id join public.kanban_boards b on b.id=l.board_id where ct.tag_id=kanban_tags.id and b.org_id=kanban_tags.org_id and public.organon_can_access_resource(b.org_id,'kanban',b.id,false)));

-- Private definer is intentional: no direct write grants, explicit auth + resource check,
-- closed actions, fixed search_path, no dynamic SQL. Public wrapper remains invoker.
create or replace function organon_kanban_private.mutate(p_action text,p_org_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_board uuid := nullif(p_payload->>'boardId','')::uuid;
 v_id uuid := nullif(p_payload->>'id','')::uuid;
 v_expected bigint := (p_payload->>'expectedRevision')::bigint;
 v_rev bigint; v_result jsonb; v_list uuid; v_old_list uuid; v_before uuid := nullif(p_payload->>'beforeId','')::uuid;
 v_pos numeric; v_other numeric; v_tag uuid; v_ref text; v_b uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>1048576 then raise exception 'Invalid payload' using errcode='22023'; end if;
 if p_action is null or p_action not in ('saveBoard','deleteBoard','saveList','deleteList','moveList','saveCard','deleteCard','moveCard','saveTag','deleteTag') then
  raise exception 'Unknown action' using errcode='22023';
 end if;
 -- The same organization row lock is used by teams permission/revoke actions.
 -- Recheck grants AFTER this lock so a concurrent revocation wins deterministically.
 perform 1 from public.organizations where id=p_org_id for update;
 -- Serializes append/reorder/tag changes across one organization, before CAS reads.
 perform pg_advisory_xact_lock(hashtextextended('organon-kanban:'||p_org_id::text,0));
 if (p_action='saveBoard' and v_id is null) or p_action in('saveTag','deleteTag') then
  if not public.organon_can_access_resource(p_org_id,'kanban',null,true) then raise exception 'Forbidden' using errcode='42501'; end if;
 else
  if not exists(select 1 from public.kanban_boards where id=v_board and org_id=p_org_id)
   or not public.organon_can_access_resource(p_org_id,'kanban',v_board,true) then raise exception 'Forbidden' using errcode='42501'; end if;
 end if;
 if p_action in ('saveTag','deleteTag') and not public.organon_can_access_resource(p_org_id,'kanban',null,true) then
  raise exception 'Organization markers require full kanban access' using errcode='42501';
 end if;
 if v_id is not null then
  if p_action in ('saveBoard','deleteBoard') then
   select revision into v_rev from public.kanban_boards where id=v_id and id=v_board and org_id=p_org_id for update;
  elsif p_action in ('saveList','deleteList','moveList') then
   select revision into v_rev from public.kanban_lists where id=v_id and board_id=v_board for update;
  elsif p_action in ('saveCard','deleteCard','moveCard') then
   select c.revision,c.list_id into v_rev,v_old_list from public.kanban_cards c join public.kanban_lists l on l.id=c.list_id where c.id=v_id and l.board_id=v_board for update of c;
  else
   select revision into v_rev from public.kanban_tags where id=v_id and org_id=p_org_id for update;
  end if;
  if v_rev is null then raise exception 'Record unavailable' using errcode='42501'; end if;
  if v_expected is null or v_rev<>v_expected then raise exception 'Revision conflict' using errcode='PT409'; end if;
 elsif p_action like 'delete%' or p_action like 'move%' then raise exception 'Missing id' using errcode='22023';
 end if;

 if p_action='saveBoard' then
  if length(trim(p_payload->>'name')) not between 1 and 300 or p_payload->>'bg_type' not in ('none','color','image') or p_payload->>'bg_size' not in ('cover','repeat') then raise exception 'Invalid board'; end if;
  v_ref := nullif(p_payload->>'bg_image_url','');
  if length(v_ref)>2000 or (p_payload->>'bg_color' is not null and (p_payload->>'bg_color') !~ '^#[0-9a-fA-F]{6}$') then raise exception 'Invalid background'; end if;
  if v_ref is not null and v_ref not like 'https://%' and (v_board is null or v_ref not like p_org_id::text||'/'||v_board::text||'/%' or v_ref ~ '\.\.') then raise exception 'Invalid asset'; end if;
  if v_id is null then
   insert into public.kanban_boards(org_id,name,bg_type,bg_color,bg_image_url,bg_size,created_by)
    values(p_org_id,p_payload->>'name',p_payload->>'bg_type',p_payload->>'bg_color',v_ref,p_payload->>'bg_size',auth.uid()) returning to_jsonb(kanban_boards.*) into v_result;
   v_board := (v_result->>'id')::uuid;
  else
   update public.kanban_boards set name=p_payload->>'name',bg_type=p_payload->>'bg_type',bg_color=p_payload->>'bg_color',bg_image_url=v_ref,bg_size=p_payload->>'bg_size',revision=revision+1,updated_at=now() where id=v_id returning to_jsonb(kanban_boards.*) into v_result;
  end if;
 elsif p_action='deleteBoard' then
  delete from public.kanban_boards where id=v_id; v_result := jsonb_build_object('id',v_id,'deleted',true);
 elsif p_action='saveList' then
  if length(trim(p_payload->>'name')) not between 1 and 300 or p_payload->>'color' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid column'; end if;
  if v_id is null then
   select coalesce(max(position),-1)+1 into v_pos from public.kanban_lists where board_id=v_board;
   insert into public.kanban_lists(board_id,name,color,position) values(v_board,p_payload->>'name',p_payload->>'color',v_pos) returning to_jsonb(kanban_lists.*) into v_result;
  else
   update public.kanban_lists set name=p_payload->>'name',color=p_payload->>'color',revision=revision+1,updated_at=now() where id=v_id returning to_jsonb(kanban_lists.*) into v_result;
  end if;
 elsif p_action='deleteList' then
  delete from public.kanban_lists where id=v_id; v_result := jsonb_build_object('id',v_id,'deleted',true);
 elsif p_action='saveCard' then
  v_list := (p_payload->>'listId')::uuid;
  if not exists(select 1 from public.kanban_lists where id=v_list and board_id=v_board) then raise exception 'Invalid column'; end if;
  if v_old_list is not null and v_old_list<>v_list then raise exception 'Use moveCard to move'; end if;
  if length(trim(p_payload->>'title')) not between 1 and 1000 or length(coalesce(p_payload->>'description',''))>200000 then raise exception 'Invalid card'; end if;
  if jsonb_typeof(p_payload->'tagIds') is distinct from 'array' or jsonb_array_length(p_payload->'tagIds')>100 then raise exception 'Invalid markers'; end if;
  if p_payload->>'price' is not null and (p_payload->>'price') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'Invalid price'; end if;
  v_ref := nullif(p_payload->>'thumbnail_url','');
  if length(v_ref)>2000 then raise exception 'Invalid asset'; end if;
  if v_ref is not null and v_ref not like 'https://%' and (v_ref not like p_org_id::text||'/'||v_board::text||'/%' or v_ref ~ '\.\.') then raise exception 'Invalid asset'; end if;
  -- A selected-board member can retain/use visible markers, never enumerate other boards.
  for v_tag in select value::uuid from jsonb_array_elements_text(p_payload->'tagIds') loop
   if not exists(select 1 from public.kanban_tags t where t.id=v_tag and t.org_id=p_org_id and
    (public.organon_can_access_resource(p_org_id,'kanban',null,false) or exists(
     select 1 from public.kanban_card_tags ct join public.kanban_cards c on c.id=ct.card_id join public.kanban_lists l on l.id=c.list_id where ct.tag_id=v_tag and l.board_id=v_board))) then raise exception 'Invalid marker' using errcode='42501'; end if;
  end loop;
  if v_id is null then
   select coalesce(max(position),-1)+1 into v_pos from public.kanban_cards where list_id=v_list;
   insert into public.kanban_cards(list_id,title,description,price,thumbnail_url,position,created_by)
    values(v_list,p_payload->>'title',coalesce(p_payload->>'description',''),(p_payload->>'price')::numeric,v_ref,v_pos,auth.uid()) returning to_jsonb(kanban_cards.*) into v_result;
   v_id := (v_result->>'id')::uuid;
  else
   update public.kanban_cards set title=p_payload->>'title',description=coalesce(p_payload->>'description',''),price=(p_payload->>'price')::numeric,thumbnail_url=v_ref,revision=revision+1,updated_at=now() where id=v_id returning to_jsonb(kanban_cards.*) into v_result;
  end if;
  delete from public.kanban_card_tags where card_id=v_id;
  insert into public.kanban_card_tags(card_id,tag_id) select v_id,value::uuid from jsonb_array_elements_text(p_payload->'tagIds') on conflict do nothing;
  update public.kanban_lists set revision=revision+1,updated_at=now() where id=v_list;
 elsif p_action='deleteCard' then
  delete from public.kanban_cards where id=v_id;
  update public.kanban_lists set revision=revision+1,updated_at=now() where id=v_old_list;
  v_result := jsonb_build_object('id',v_id,'deleted',true);
 elsif p_action='moveCard' then
  v_list := (p_payload->>'listId')::uuid;
  if not exists(select 1 from public.kanban_lists where id=v_list and board_id=v_board) or v_before=v_id then raise exception 'Invalid destination'; end if;
  -- Normalize only this target column under organization lock. Revisions change for affected cards.
  with ordered as (select id,row_number() over(order by position,id)-1 as pos from public.kanban_cards where list_id=v_list and id<>v_id)
   update public.kanban_cards c set position=o.pos,revision=c.revision+1,updated_at=now() from ordered o where c.id=o.id and c.position<>o.pos;
  if v_before is null then select coalesce(max(position),-1)+1 into v_pos from public.kanban_cards where list_id=v_list and id<>v_id;
  else
   select position into v_pos from public.kanban_cards where id=v_before and list_id=v_list and id<>v_id;
   if v_pos is null then raise exception 'Destination changed' using errcode='PT409'; end if;
   update public.kanban_cards set position=position+1,revision=revision+1,updated_at=now() where list_id=v_list and id<>v_id and position>=v_pos;
  end if;
  update public.kanban_cards set list_id=v_list,position=v_pos,revision=revision+1,updated_at=now() where id=v_id returning to_jsonb(kanban_cards.*) into v_result;
  update public.kanban_lists set revision=revision+1,updated_at=now() where id in(v_old_list,v_list);
 elsif p_action='moveList' then
  if v_before=v_id then raise exception 'Invalid destination'; end if;
  with ordered as(select id,row_number() over(order by position,id)-1 as pos from public.kanban_lists where board_id=v_board and id<>v_id)
   update public.kanban_lists l set position=o.pos,revision=l.revision+1,updated_at=now() from ordered o where l.id=o.id and l.position<>o.pos;
  if v_before is null then select coalesce(max(position),-1)+1 into v_pos from public.kanban_lists where board_id=v_board and id<>v_id;
  else
   select position into v_pos from public.kanban_lists where id=v_before and board_id=v_board and id<>v_id;
   if v_pos is null then raise exception 'Destination changed' using errcode='PT409'; end if;
   update public.kanban_lists set position=position+1,revision=revision+1,updated_at=now() where board_id=v_board and id<>v_id and position>=v_pos;
  end if;
  update public.kanban_lists set position=v_pos,revision=revision+1,updated_at=now() where id=v_id returning to_jsonb(kanban_lists.*) into v_result;
 elsif p_action='saveTag' then
  if length(trim(p_payload->>'name')) not between 1 and 150 or p_payload->>'color' !~ '^#[0-9a-fA-F]{6}$' or length(p_payload->>'icon') not between 1 and 80 then raise exception 'Invalid marker'; end if;
  if v_id is null then
   insert into public.kanban_tags(org_id,name,color,icon,created_by) values(p_org_id,p_payload->>'name',p_payload->>'color',p_payload->>'icon',auth.uid()) returning to_jsonb(kanban_tags.*) into v_result;
  else
   update public.kanban_tags set name=p_payload->>'name',color=p_payload->>'color',icon=p_payload->>'icon',revision=revision+1,updated_at=now() where id=v_id returning to_jsonb(kanban_tags.*) into v_result;
  end if;
 elsif p_action='deleteTag' then
  -- Invalidates open card editors before cascading links, preventing silent link resurrection.
  update public.kanban_cards set revision=revision+1,updated_at=now() where id in(select card_id from public.kanban_card_tags where tag_id=v_id);
  update public.kanban_lists set revision=revision+1,updated_at=now() where id in(select c.list_id from public.kanban_cards c join public.kanban_card_tags ct on ct.card_id=c.id where ct.tag_id=v_id);
  delete from public.kanban_tags where id=v_id; v_result := jsonb_build_object('id',v_id,'deleted',true);
 end if;
 if p_action in('saveTag','deleteTag') then
  -- No marker names/content in broadcasts, including channels with revoked members.
  for v_b in select id from public.kanban_boards where org_id=p_org_id loop
   update public.kanban_boards set revision=revision+1,updated_at=now() where id=v_b;
   perform realtime.send(jsonb_build_object('orgId',p_org_id,'boardId',v_b),'changed','kanban:'||p_org_id::text||':'||v_b::text,true);
  end loop;
 elsif p_action not in('saveBoard','deleteBoard') then
  update public.kanban_boards set revision=revision+1,updated_at=now() where id=v_board;
 end if;
 if v_board is not null then
  perform realtime.send(jsonb_build_object('orgId',p_org_id,'boardId',v_board),'changed','kanban:'||p_org_id::text||':'||v_board::text,true);
 end if;
 perform realtime.send(jsonb_build_object('orgId',p_org_id),'changed','kanban:'||p_org_id::text,true);
 return v_result;
end $$;
revoke all on function organon_kanban_private.mutate(text,uuid,jsonb) from public,anon;
grant execute on function organon_kanban_private.mutate(text,uuid,jsonb) to authenticated;

create or replace function public.organon_kanban(p_action text,p_org_id uuid,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_board uuid := (p_payload->>'boardId')::uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action='getBoards' then
  select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at,b.id),'[]') into v_result from public.kanban_boards b where org_id=p_org_id;
  return v_result;
 elsif p_action='getTags' then
  return jsonb_build_object('tags',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]') from public.kanban_tags t where org_id=p_org_id),
   'canManageTags',public.organon_can_access_resource(p_org_id,'kanban',null,true),'canCreateBoard',public.organon_can_access_resource(p_org_id,'kanban',null,true));
 elsif p_action='getBoard' then
  if not exists(select 1 from public.kanban_boards where id=v_board and org_id=p_org_id) then raise exception 'Forbidden' using errcode='42501'; end if;
  select jsonb_build_object(
   'board',(select to_jsonb(b) from public.kanban_boards b where id=v_board),
   'lists',(select coalesce(jsonb_agg(to_jsonb(l) order by l.position,l.id),'[]') from public.kanban_lists l where board_id=v_board),
   'cards',(select coalesce(jsonb_agg(to_jsonb(c) order by c.position,c.id),'[]') from public.kanban_cards c join public.kanban_lists l on l.id=c.list_id where l.board_id=v_board),
   'tags',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]') from public.kanban_tags t where org_id=p_org_id and
    (public.organon_can_access_resource(p_org_id,'kanban',null,false) or exists(select 1 from public.kanban_card_tags ct join public.kanban_cards c on c.id=ct.card_id join public.kanban_lists l on l.id=c.list_id where ct.tag_id=t.id and l.board_id=v_board))),
   'cardTags',(select coalesce(jsonb_agg(jsonb_build_object('card_id',ct.card_id,'tag_id',ct.tag_id)),'[]') from public.kanban_card_tags ct join public.kanban_cards c on c.id=ct.card_id join public.kanban_lists l on l.id=c.list_id where l.board_id=v_board),
   'canWrite',public.organon_can_access_resource(p_org_id,'kanban',v_board,true),
   'canManageTags',public.organon_can_access_resource(p_org_id,'kanban',null,true)
  ) into v_result;
  return v_result;
 else return organon_kanban_private.mutate(p_action,p_org_id,p_payload);
 end if;
end $$;
revoke all on function public.organon_kanban(text,uuid,jsonb) from public,anon;
grant execute on function public.organon_kanban(text,uuid,jsonb) to authenticated;

-- Private assets scoped by org AND board, never by an organization-wide read grant alone.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('organon-kanban','organon-kanban',false,5242880,array['image/png','image/jpeg','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists organon_kanban_asset_read on storage.objects;
create policy organon_kanban_asset_read on storage.objects for select to authenticated using (
 bucket_id='organon-kanban' and exists(select 1 from public.kanban_boards b where b.org_id::text=split_part(storage.objects.name,'/',1) and b.id::text=split_part(storage.objects.name,'/',2) and public.organon_can_access_resource(b.org_id,'kanban',b.id,false)));
drop policy if exists organon_kanban_asset_insert on storage.objects;
create policy organon_kanban_asset_insert on storage.objects for insert to authenticated with check (
 bucket_id='organon-kanban' and name !~ '\.\.' and exists(select 1 from public.kanban_boards b where b.org_id::text=split_part(storage.objects.name,'/',1) and b.id::text=split_part(storage.objects.name,'/',2) and public.organon_can_access_resource(b.org_id,'kanban',b.id,true)));
-- Immutable object names; no UPDATE/DELETE granted by this module (retain backup references).
drop policy if exists organon_kanban_broadcast_read on realtime.messages;
create policy organon_kanban_broadcast_read on realtime.messages for select to authenticated using (
 extension='broadcast' and (
  exists(select 1 from public.kanban_boards b where realtime.topic()='kanban:'||b.org_id::text||':'||b.id::text)
  or exists(select 1 from public.organizations o where realtime.topic()='kanban:'||o.id::text and public.organon_can_access_resource(o.id,'kanban',null,false))
 ));
commit;
