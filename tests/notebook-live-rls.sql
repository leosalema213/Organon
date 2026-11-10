-- Run after sharing-recipients.sql + notebook-live.sql. Synthetic data; always rollback.
begin;
insert into auth.users(id,email,is_anonymous) values
 ('92910000-0000-4000-8000-000000000001','owner@notebook-live.invalid',false),
 ('92910000-0000-4000-8000-000000000002','writer@notebook-live.invalid',false),
 ('92910000-0000-4000-8000-000000000003','reader@notebook-live.invalid',false);
insert into public.organizations(id,name,owner_id) values('92920000-0000-4000-8000-000000000001','Synthetic notebook live','92910000-0000-4000-8000-000000000001');
insert into public.organon_team_members(org_id,user_id,status,grants) values
 ('92920000-0000-4000-8000-000000000001','92910000-0000-4000-8000-000000000002','accepted','{"notebooks":{"mode":"all","ids":[],"write":true}}'),
 ('92920000-0000-4000-8000-000000000001','92910000-0000-4000-8000-000000000003','accepted','{"notebooks":{"mode":"all","ids":[],"write":false}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','92910000-0000-4000-8000-000000000001',true);
do $$
declare o uuid:='92920000-0000-4000-8000-000000000001'; owner_id uuid:='92910000-0000-4000-8000-000000000001';
 a uuid:='92910000-0000-4000-8000-000000000002'; b uuid:='92910000-0000-4000-8000-000000000003'; r uuid:='92940000-0000-4000-8000-000000000001';
 payload jsonb; result jsonb; audience jsonb; stamp timestamptz;
begin
 payload:=jsonb_build_object('orgId',o,'module','notebooks','resourceId',r,'revision',0,'content',jsonb_build_object('id',r,'name','Synthetic','pages','[]'::jsonb),'assets','[]'::jsonb);
 result:=public.organon_teams('publish',payload);
 if result->>'last_edited_by' is distinct from owner_id::text or result->>'last_edited_at' is null then raise exception 'Initial author stamp missing'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 result:=public.organon_teams('editResource',payload||jsonb_build_object('revision',1,'last_edited_by',owner_id,'content',jsonb_build_object('id',r,'name','Writer edit','pages','[]'::jsonb)));
 if result->>'last_edited_by' is distinct from a::text or result->>'published_by' is distinct from owner_id::text then raise exception 'Actor spoofing or publisher changed'; end if;
 stamp:=(result->>'last_edited_at')::timestamptz;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if (select count(*) from public.organon_team_notifications where user_id=b and kind='shared_notebooks')<>1 then raise exception 'Autosave generated duplicate publication notices'; end if;
 if not exists(select 1 from public.organon_shared_resources where resource_id=r and last_edited_by=a) then raise exception 'Reader cannot read last editor'; end if;
 begin
  perform public.organon_teams('editResource',payload||jsonb_build_object('revision',2));
  raise exception 'Reader changed notebook' using errcode='P9999';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 audience:=public.organon_teams('shareRecipients',payload);
 perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',2,'recipientIds',jsonb_build_array(a,b),'audienceToken',audience->>'token'));
 if exists(select 1 from public.organon_shared_resources where resource_id=r and (last_edited_by is distinct from a or last_edited_at is distinct from stamp)) then raise exception 'Audience update replaced last content editor'; end if;
end; $$;
reset role;
rollback;
