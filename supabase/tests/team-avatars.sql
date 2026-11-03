-- Administrative SQL verification only. No blobs are uploaded and all rows are rolled back.
begin;
do $$
declare
 admin_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid(); peer_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid(); stranger_id uuid:=gen_random_uuid();
 space_id uuid:=gen_random_uuid(); viewer_member uuid:=gen_random_uuid();
 current_hash text:=repeat('a',64); private_hash text:=repeat('b',64); next_hash text:=repeat('c',64); n integer;
begin
 insert into auth.users(id,aud,role,email,is_anonymous,created_at,updated_at)
 select x,'authenticated','authenticated','organon-avatar-test-'||x::text||'@example.invalid',false,now(),now()
 from unnest(array[admin_id,viewer_id,peer_id,pending_id,stranger_id]) x;
 insert into public.organon_profiles(user_id,name,nickname,avatar_hash)
 select x,'Pessoa sintética','Teste',current_hash from unnest(array[admin_id,viewer_id,peer_id,pending_id]) x;
 insert into public.organizations(id,name,owner_id) values(space_id,'Equipe avatar descartável',admin_id);
 insert into public.organon_team_members(id,org_id,user_id,status) values
 (viewer_member,space_id,viewer_id,'accepted'),(gen_random_uuid(),space_id,peer_id,'accepted'),(gen_random_uuid(),space_id,pending_id,'pending');
 insert into storage.objects(bucket_id,name)
 select 'organon-assets',x::text||'/'||current_hash from unnest(array[admin_id,viewer_id,peer_id,pending_id]) x;
 insert into storage.objects(bucket_id,name) values('organon-assets',peer_id::text||'/'||private_hash),('organon-assets',peer_id::text||'/'||next_hash);
 if has_function_privilege('anon','organon_private.can_view_team_avatar(text)','EXECUTE') then raise exception 'Avatar helper exposed to anon'; end if;
 if (select b.public from storage.buckets b where b.id='organon-assets') then raise exception 'Profile bucket is public'; end if;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',viewer_id::text,true);
 select count(*) into n from storage.objects where bucket_id='organon-assets' and name in (admin_id::text||'/'||current_hash,peer_id::text||'/'||current_hash);
 if n<>2 then raise exception 'Accepted member cannot read team avatars'; end if;
 select count(*) into n from storage.objects where bucket_id='organon-assets' and name in (pending_id::text||'/'||current_hash,peer_id::text||'/'||private_hash,peer_id::text||'/'||next_hash);
 if n<>0 then raise exception 'Avatar policy exposes pending member or other private files'; end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 select count(*) into n from storage.objects where bucket_id='organon-assets' and name in (pending_id::text||'/'||current_hash,peer_id::text||'/'||current_hash);
 if n<>2 then raise exception 'Owner cannot read roster avatars'; end if;
 if exists(select 1 from storage.objects where bucket_id='organon-assets' and name=peer_id::text||'/'||private_hash) then raise exception 'Owner can read other member files'; end if;
 perform set_config('request.jwt.claim.sub',stranger_id::text,true);
 if exists(select 1 from storage.objects where bucket_id='organon-assets' and name=peer_id::text||'/'||current_hash) then raise exception 'Stranger can read member photo'; end if;
 execute 'reset role';
 update public.organon_profiles set avatar_hash=next_hash where user_id=peer_id;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',viewer_id::text,true);
 if exists(select 1 from storage.objects where bucket_id='organon-assets' and name=peer_id::text||'/'||current_hash) then raise exception 'Stale photo remains authorized'; end if;
 if not exists(select 1 from storage.objects where bucket_id='organon-assets' and name=peer_id::text||'/'||next_hash) then raise exception 'Current photo is not authorized'; end if;
 if not exists(select 1 from jsonb_array_elements(public.organon_teams('roster',jsonb_build_object('orgId',space_id))) m where m->>'user_id'=peer_id::text and m->>'avatar_hash'=next_hash) then raise exception 'Roster does not return current photo'; end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform public.organon_teams('revoke',jsonb_build_object('orgId',space_id,'id',viewer_member,'revision',1));
 perform set_config('request.jwt.claim.sub',viewer_id::text,true);
 if exists(select 1 from storage.objects where bucket_id='organon-assets' and name in (admin_id::text||'/'||current_hash,peer_id::text||'/'||next_hash)) then raise exception 'Revoked member retains access'; end if;
 execute 'reset role';
end $$;
rollback;
select 'Team avatar RLS checks passed; synthetic rows rolled back.' as result;
