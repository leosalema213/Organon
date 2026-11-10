-- Run after sharing-recipients.sql. Synthetic IDs; always rollback.
begin;
insert into auth.users(id,email,is_anonymous) values
 ('92710000-0000-4000-8000-000000000001','owner@recipients.invalid',false),
 ('92710000-0000-4000-8000-000000000002','first@recipients.invalid',false),
 ('92710000-0000-4000-8000-000000000003','second@recipients.invalid',false),
 ('92710000-0000-4000-8000-000000000004','pending@recipients.invalid',false);
insert into public.organizations(id,name,owner_id) values('92720000-0000-4000-8000-000000000001','Synthetic recipients','92710000-0000-4000-8000-000000000001');
insert into public.organon_team_members(org_id,user_id,status,grants) values
 ('92720000-0000-4000-8000-000000000001','92710000-0000-4000-8000-000000000002','accepted','{}'),
 ('92720000-0000-4000-8000-000000000001','92710000-0000-4000-8000-000000000003','accepted','{"books":{"mode":"all","ids":[],"write":true},"notebooks":{"mode":"all","ids":[],"write":true}}'),
 ('92720000-0000-4000-8000-000000000001','92710000-0000-4000-8000-000000000004','pending','{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','92710000-0000-4000-8000-000000000001',true);
do $$
declare o uuid:='92720000-0000-4000-8000-000000000001'; a uuid:='92710000-0000-4000-8000-000000000002'; b uuid:='92710000-0000-4000-8000-000000000003';
 r uuid; n text; audience jsonb; payload jsonb; token text;
begin
 foreach n in array array['books','notebooks'] loop
  r:=case n when 'books' then '92740000-0000-4000-8000-000000000001'::uuid else '92740000-0000-4000-8000-000000000002'::uuid end;
  payload:=jsonb_build_object('orgId',o,'module',n,'resourceId',r,'revision',0,'content',jsonb_build_object('id',r,'name','Synthetic','pages','[]'::jsonb),'assets','[]'::jsonb);
  -- Older entry point without recipientIds must grant access to current accepted members.
  perform public.organon_teams('publish',payload);
  perform set_config('request.jwt.claim.sub',a::text,true);
  if not public.organon_can_access_resource(o,n,r) or public.organon_can_access_resource(o,n,r,true) then raise exception 'Default read-only access failed'; end if;
  if not exists(select 1 from public.organon_team_notifications where user_id=a and kind='shared_'||n) then raise exception 'Publication notice missing'; end if;
  perform set_config('request.jwt.claim.sub','92710000-0000-4000-8000-000000000001',true);
  audience:=public.organon_teams('shareRecipients',payload); token:=audience->>'token';
  if jsonb_array_length(audience->'members')<>2 then raise exception 'Pending member was included'; end if;
  -- Restrict to A; B retains the all/future scope but receives an exception for just this resource.
  perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',1,'recipientIds',jsonb_build_array(a),'audienceToken',token));
  if (select grants->n->>'mode' from public.organon_team_members where org_id=o and user_id=b)<>'all' then raise exception 'Future scope lost'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  if public.organon_can_access_resource(o,n,r) or public.organon_can_access_resource(o,n,r,true) then raise exception 'Excluded recipient retained access'; end if;
  if not public.organon_can_access_resource(o,n,'92740000-0000-4000-8000-000000000099',true) then raise exception 'Other/future permission changed'; end if;
  perform set_config('request.jwt.claim.sub','92710000-0000-4000-8000-000000000001',true);
  begin
   perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',2,'recipientIds',jsonb_build_array(b),'audienceToken',token));
   raise exception 'Stale audience accepted';
  exception when sqlstate 'PT409' then null; end;
  audience:=public.organon_teams('shareRecipients',payload);
  begin
   perform public.organon_teams('publish',payload||jsonb_build_object('revision',2,'recipientIds',jsonb_build_array(a,b),'audienceToken',audience->>'token','assets',jsonb_build_array('invalid-private-asset')));
   raise exception 'Invalid assets accepted' using errcode='P9999';
  exception when sqlstate 'P0001' then null; end;
  if public.organon_teams('shareRecipients',payload)->>'token' is distinct from audience->>'token' then raise exception 'Failed publication changed grants'; end if;
  begin
   perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',2,'recipientIds',jsonb_build_array('92710000-0000-4000-8000-000000000004'),'audienceToken',audience->>'token'));
   raise exception 'Pending recipient accepted';
  exception when insufficient_privilege then null; end;
  if (public.organon_teams('shareRecipients',payload)->>'revision')::integer<>2 then raise exception 'Failed operation changed revision'; end if;
  perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',2,'recipientIds',jsonb_build_array(a,b),'audienceToken',audience->>'token'));
  perform set_config('request.jwt.claim.sub',b::text,true);
  if not public.organon_can_access_resource(o,n,r,true) then raise exception 'Prior editing permission lost'; end if;
  begin
   perform public.organon_teams('setRecipients',payload||jsonb_build_object('revision',3,'recipientIds','[]'::jsonb,'audienceToken',token));
   raise exception 'Non-publisher changed audience';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','92710000-0000-4000-8000-000000000001',true);
  perform public.organon_teams('unpublish',payload||jsonb_build_object('revision',3));
  perform set_config('request.jwt.claim.sub',a::text,true);
  if exists(select 1 from public.organon_shared_resources where org_id=o and module=n and resource_id=r) then raise exception 'Unpublished resource visible'; end if;
  perform set_config('request.jwt.claim.sub','92710000-0000-4000-8000-000000000001',true);
 end loop;
 -- A member can choose recipients for their own content, but cannot hide it from the owner.
 perform set_config('request.jwt.claim.sub',a::text,true);
 payload:=jsonb_build_object('orgId',o,'module','notebooks','resourceId','92740000-0000-4000-8000-000000000099','revision',0,'content',jsonb_build_object('id','92740000-0000-4000-8000-000000000099'),'assets','[]'::jsonb);
 audience:=public.organon_teams('shareRecipients',payload);
 if not exists(select 1 from jsonb_array_elements(audience->'members') x where x->>'user_id'='92710000-0000-4000-8000-000000000001' and (x->>'fixed')::boolean) then raise exception 'Administrative access not shown'; end if;
 perform public.organon_teams('publish',payload||jsonb_build_object('recipientIds','[]'::jsonb,'audienceToken',audience->>'token'));
 perform set_config('request.jwt.claim.sub','92710000-0000-4000-8000-000000000001',true);
 if not public.organon_can_access_resource(o,'notebooks','92740000-0000-4000-8000-000000000099') then raise exception 'Owner lost administrative access'; end if;
end $$;
rollback;
