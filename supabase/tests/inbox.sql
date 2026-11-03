-- Run through the administrative SQL connection only. Every fixture is rolled back.
begin;
do $$
declare
 owner_user uuid := gen_random_uuid(); guest_user uuid := gen_random_uuid(); invited_user uuid := gen_random_uuid(); outsider_user uuid := gen_random_uuid();
 org uuid := gen_random_uuid(); guest_member uuid := gen_random_uuid(); invited_member uuid := gen_random_uuid();
 own_notice uuid := gen_random_uuid(); other_notice uuid := gen_random_uuid(); result jsonb; accepted jsonb;
begin
 insert into auth.users(id,aud,role,email,is_anonymous,created_at,updated_at)
 select x,'authenticated','authenticated','organon-inbox-test-'||x::text||'@example.invalid',false,now(),now()
 from unnest(array[owner_user,guest_user,invited_user,outsider_user]) x;
 insert into public.organon_profiles(user_id,name,nickname) values(owner_user,'Admin sintético','Admin'),(guest_user,'Membro sintético','Membro'),(invited_user,'Convidado sintético','Convidado');
 insert into public.organizations(id,name,owner_id) values(org,'Equipe sintética descartável',owner_user);
 insert into public.organon_team_members(id,org_id,user_id,status,grants) values
  (guest_member,org,guest_user,'accepted','{"notebooks":{"mode":"all","ids":[],"write":false}}'),
  (invited_member,org,invited_user,'pending','{}');
 insert into public.organon_team_notifications(id,user_id,member_id,kind) values
  (own_notice,invited_user,invited_member,'invitation'),(other_notice,owner_user,invited_member,'permissions'),
  (gen_random_uuid(),invited_user,invited_member,'permissions');
 if has_function_privilege('anon','public.organon_teams(text,jsonb)','EXECUTE') or has_function_privilege('anon','organon_private.inbox(text,jsonb)','EXECUTE') then raise exception 'Anonymous RPC exposed'; end if;
 if not has_function_privilege('authenticated','public.organon_teams(text,jsonb)','EXECUTE') then raise exception 'Authenticated RPC inaccessible'; end if;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',invited_user::text,true);
 result:=public.organon_teams('inbox','{}');
 if (result->>'unreadCount')::integer<>2 or jsonb_array_length(result->'invitations')<>1 then raise exception 'Incorrect invitation inbox'; end if;
 perform public.organon_teams('deleteNotice',jsonb_build_object('id',other_notice,'user_id',owner_user));
 perform public.organon_teams('readAll','{}');
 result:=public.organon_teams('inbox','{}');
 if (result->>'unreadCount')::integer<>0 then raise exception 'Unread receipts remain'; end if;
 perform public.organon_teams('deleteNotice',jsonb_build_object('id',own_notice));
 result:=public.organon_teams('inbox','{}');
 if jsonb_array_length(result->'notifications')<>1 then raise exception 'Individual deletion failed'; end if;
 perform public.organon_teams('deleteAllNotices',jsonb_build_object('user_id',owner_user));
 result:=public.organon_teams('inbox','{}');
 if jsonb_array_length(result->'notifications')<>0 or jsonb_array_length(result->'invitations')<>1 then raise exception 'Deleting notices changed invitations'; end if;
 begin
  perform public.organon_teams('roster',jsonb_build_object('orgId',org)); raise exception 'Pending recipient read roster';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 result:=public.organon_teams('inbox','{}');
 if (result->>'unreadCount')::integer<>1 then raise exception 'A different user inbox was changed'; end if;
 result:=public.organon_teams('roster',jsonb_build_object('orgId',org));
 if jsonb_array_length(result)<>3 then raise exception 'Owner roster missing members'; end if;
 perform set_config('request.jwt.claim.sub',guest_user::text,true);
 result:=public.organon_teams('roster',jsonb_build_object('orgId',org));
 if jsonb_array_length(result)<>2 or exists(select 1 from jsonb_array_elements(result) x where x->>'status'<>'accepted' or x->>'grants' is not null or x->>'revision' is not null or x ? 'email') then raise exception 'Guest roster exposes administrative fields'; end if;
 begin
  perform public.organon_teams('members',jsonb_build_object('orgId',org)); raise exception 'Guest accessed owner-only catalog guard';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',outsider_user::text,true);
 begin
  perform public.organon_teams('roster',jsonb_build_object('orgId',org)); raise exception 'Outsider read roster';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',invited_user::text,true);
 accepted:=public.organon_teams('respond',jsonb_build_object('id',invited_member,'revision',1,'response','accepted'));
 result:=public.organon_teams('roster',jsonb_build_object('orgId',org));
 if jsonb_array_length(result)<>3 then raise exception 'Invitation cannot be accepted after deleting its notices'; end if;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform public.organon_teams('revoke',jsonb_build_object('orgId',org,'id',invited_member,'revision',(accepted->>'revision')::integer));
 perform set_config('request.jwt.claim.sub',invited_user::text,true);
 begin
  perform public.organon_teams('roster',jsonb_build_object('orgId',org)); raise exception 'Revoked member read roster';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
end $$;
rollback;
select 'Inbox/roster checks passed; all synthetic fixtures rolled back.' as result;
