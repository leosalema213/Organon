-- Prepared for a disposable local Supabase only, after profile.sql + modules/teams.sql.
-- Synthetic identities; rollback. Do not point this file at production.
begin;
insert into auth.users(id,email,is_anonymous) values
 ('10000000-0000-4000-8000-000000000001','owner@teams.invalid',false),
 ('10000000-0000-4000-8000-000000000002','member@teams.invalid',false),
 ('10000000-0000-4000-8000-000000000003','outsider@teams.invalid',false);
insert into public.organizations(id,name,owner_id) values('20000000-0000-4000-8000-000000000001','Synthetic team','10000000-0000-4000-8000-000000000001');
insert into public.organon_team_members(id,org_id,user_id,status,grants) values(
 '30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','pending',
 '{"notebooks":{"mode":"selected","ids":["40000000-0000-4000-8000-000000000001"],"write":false},"financeiro":{"mode":"all","ids":[],"write":true}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
 if public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','financeiro') then raise exception 'Pending invitation granted access'; end if;
 begin
  perform public.organon_teams('permissions','{"orgId":"20000000-0000-4000-8000-000000000001","id":"30000000-0000-4000-8000-000000000001","revision":1,"grants":{}}');
  raise exception 'Non-owner modified grants';
 exception when insufficient_privilege then null; end;
 perform public.organon_teams('respond','{"id":"30000000-0000-4000-8000-000000000001","revision":1,"response":"accepted"}');
 if not public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','financeiro',null,true) then raise exception 'Accepted finance grant denied'; end if;
 if public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','mei') then raise exception 'Member can access MEI'; end if;
 if not public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','notebooks','40000000-0000-4000-8000-000000000001') then raise exception 'Selected notebook denied'; end if;
 if public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','notebooks','40000000-0000-4000-8000-000000000002') then raise exception 'Unselected notebook exposed'; end if;
 if public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','notebooks','40000000-0000-4000-8000-000000000001',true) then raise exception 'Read-only notebook is writable'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.organizations where id='20000000-0000-4000-8000-000000000001') then raise exception 'Organization exposed to outsider'; end if;
 if exists(select 1 from public.organon_team_members) then raise exception 'Membership exposed to outsider'; end if;
 begin
  perform public.organon_teams('respond','{"id":"30000000-0000-4000-8000-000000000001","revision":2,"response":"accepted"}');
  raise exception 'Outsider accepted invitation';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin
 if not public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','mei') then raise exception 'Owner MEI denied'; end if;
 begin
  perform public.organon_teams('revoke','{"orgId":"20000000-0000-4000-8000-000000000001","id":"30000000-0000-4000-8000-000000000001","revision":1}');
  raise exception 'Stale revision overwrote accepted invitation';
 exception when sqlstate 'PT409' then null; end;
 perform public.organon_teams('revoke','{"orgId":"20000000-0000-4000-8000-000000000001","id":"30000000-0000-4000-8000-000000000001","revision":2}');
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
 if public.organon_can_access_resource('20000000-0000-4000-8000-000000000001','financeiro') then raise exception 'Revoked grant remains active'; end if;
end $$;
rollback;
