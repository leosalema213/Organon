-- Run after sharing-resource-permissions.sql in an isolated PostgreSQL session.
-- Synthetic fixtures only; always rollback. This is not evidence of remote validation.
begin;
insert into auth.users(id,email,is_anonymous) values
 ('92810000-0000-4000-8000-000000000001','owner@resource-permissions.invalid',false),
 ('92810000-0000-4000-8000-000000000002','reader@resource-permissions.invalid',false),
 ('92810000-0000-4000-8000-000000000003','writer@resource-permissions.invalid',false);
insert into public.organizations(id,name,owner_id) values('92820000-0000-4000-8000-000000000001','Synthetic resource permissions','92810000-0000-4000-8000-000000000001');
insert into public.organon_team_members(org_id,user_id,status,grants) values
 ('92820000-0000-4000-8000-000000000001','92810000-0000-4000-8000-000000000002','accepted','{}'),
 ('92820000-0000-4000-8000-000000000001','92810000-0000-4000-8000-000000000003','accepted','{"books":{"mode":"all","ids":[],"write":true},"notebooks":{"mode":"all","ids":[],"write":true}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','92810000-0000-4000-8000-000000000001',true);
do $$
declare o uuid:='92820000-0000-4000-8000-000000000001'; owner_id uuid:='92810000-0000-4000-8000-000000000001';
 a uuid:='92810000-0000-4000-8000-000000000002'; b uuid:='92810000-0000-4000-8000-000000000003';
 r uuid:='92840000-0000-4000-8000-000000000001'; other_id uuid:='92840000-0000-4000-8000-000000000002';
 n text; payload jsonb; audience jsonb; revision integer; saved_grants jsonb;
begin
 foreach n in array array['books','notebooks'] loop
  payload:=jsonb_build_object('orgId',o,'module',n,'resourceId',r,'revision',0,'content',jsonb_build_object('id',r,'name','Synthetic','pages','[]'::jsonb),'assets','[]'::jsonb);
  audience:=public.organon_teams('shareRecipients',payload);
  if audience->>'permissionsVersion'<>'1' then raise exception 'Capability missing'; end if;
  perform public.organon_teams('publish',payload||jsonb_build_object('recipientIds',jsonb_build_array(a,b),'audienceToken',audience->>'token','recipientWrites',jsonb_build_object(a::text,true,b::text,false)));
  perform set_config('request.jwt.claim.sub',a::text,true);
  if not public.organon_can_access_resource(o,n,r,true) or public.organon_can_access_resource(o,n,other_id,true) then raise exception 'Reader gained global write or lost target write'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  if not public.organon_can_access_resource(o,n,r) or public.organon_can_access_resource(o,n,r,true) or not public.organon_can_access_resource(o,n,other_id,true) then raise exception 'Writer read override leaked to other resources'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  audience:=public.organon_teams('shareRecipients',payload);
  if not exists(select 1 from jsonb_array_elements(audience->'members') m where m->>'user_id'=a::text and m->>'write'='true') then raise exception 'Effective write missing'; end if;
  saved_grants:=(select grants from public.organon_team_members where org_id=o and user_id=b);
  -- Grant changes and document revision are atomic, including invalid writes.
  begin
   perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',1,'recipientIds',jsonb_build_array(a,b),'audienceToken',audience->>'token','recipientWrites',jsonb_build_object(owner_id::text,false)));
   raise exception 'Administrative write override accepted' using errcode='P9999';
  exception when insufficient_privilege then null; end;
  if saved_grants is distinct from (select grants from public.organon_team_members where org_id=o and user_id=b) then raise exception 'Rejected action changed grants'; end if;
  perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',1,'recipientIds',jsonb_build_array(a,b),'audienceToken',audience->>'token','recipientWrites',jsonb_build_object(a::text,false)));
  begin
   perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',2,'recipientIds',jsonb_build_array(a,b),'audienceToken',audience->>'token'));
   raise exception 'Token ignored changed effective write' using errcode='P9999';
  exception when sqlstate 'PT409' then null; end;
  perform set_config('request.jwt.claim.sub',a::text,true);
  if public.organon_can_access_resource(o,n,r,true) then raise exception 'Read downgrade failed'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  audience:=public.organon_teams('shareRecipients',payload);
  perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',2,'recipientIds','[]'::jsonb,'audienceToken',audience->>'token'));
  perform set_config('request.jwt.claim.sub',a::text,true);
  if public.organon_can_access_resource(o,n,r) then raise exception 'Write override bypassed revocation'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  if not public.organon_can_access_resource(o,n,r,true) then raise exception 'Owner lost administration'; end if;
 end loop;
end; $$;
reset role;
rollback;
