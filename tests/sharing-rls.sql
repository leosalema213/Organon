-- Synthetic database validation after sharing.sql; the transaction always rolls back.
-- Fixed IDs intentionally fail on collision instead of modifying existing records.
begin;
insert into auth.users(id,email,is_anonymous) values
 ('91710000-0000-4000-8000-000000000001','owner@sharing.invalid',false),
 ('91710000-0000-4000-8000-000000000002','member@sharing.invalid',false),
 ('91710000-0000-4000-8000-000000000003','outsider@sharing.invalid',false);
insert into public.organizations(id,name,owner_id) values('91720000-0000-4000-8000-000000000001','Synthetic sharing','91710000-0000-4000-8000-000000000001');
insert into public.organon_team_members(id,org_id,user_id,status,grants) values('91730000-0000-4000-8000-000000000001','91720000-0000-4000-8000-000000000001','91710000-0000-4000-8000-000000000002','accepted','{}');
set local role authenticated;
select set_config('request.jwt.claim.sub','91710000-0000-4000-8000-000000000001',true);
select public.organon_teams('publish','{"orgId":"91720000-0000-4000-8000-000000000001","module":"books","resourceId":"91740000-0000-4000-8000-000000000001","revision":0,"content":{"id":"91740000-0000-4000-8000-000000000001","title":"Selected synthetic book"},"assets":[]}');
select public.organon_teams('publish','{"orgId":"91720000-0000-4000-8000-000000000001","module":"books","resourceId":"91740000-0000-4000-8000-000000000002","revision":0,"content":{"id":"91740000-0000-4000-8000-000000000002","title":"Hidden synthetic book"},"assets":[]}');
select public.organon_teams('permissions','{"orgId":"91720000-0000-4000-8000-000000000001","id":"91730000-0000-4000-8000-000000000001","revision":1,"grants":{"books":{"mode":"selected","ids":["91740000-0000-4000-8000-000000000001"],"write":false},"notebooks":{"mode":"all","ids":[],"write":false}}}');
select public.organon_teams('publish','{"orgId":"91720000-0000-4000-8000-000000000001","module":"books","resourceId":"91740000-0000-4000-8000-000000000001","revision":1,"content":{"id":"91740000-0000-4000-8000-000000000001","title":"Updated selected book"},"assets":[]}');
select set_config('request.jwt.claim.sub','91710000-0000-4000-8000-000000000002',true);
do $$ begin
 if not exists(select 1 from public.organon_team_notifications where user_id=auth.uid() and member_id='91730000-0000-4000-8000-000000000001' and kind='shared_books') then raise exception 'Selected-book update notice missing'; end if;
 if not public.organon_can_access_resource('91720000-0000-4000-8000-000000000001','books','91740000-0000-4000-8000-000000000001') then raise exception 'Selected book denied'; end if;
 if public.organon_can_access_resource('91720000-0000-4000-8000-000000000001','books','91740000-0000-4000-8000-000000000002') then raise exception 'Hidden book exposed'; end if;
 if public.organon_can_access_resource('91720000-0000-4000-8000-000000000001','books','91740000-0000-4000-8000-000000000001',true) then raise exception 'Read-only grant became writable'; end if;
 if (select count(*) from public.organon_shared_resources where org_id='91720000-0000-4000-8000-000000000001')<>1 then raise exception 'Resource RLS failed'; end if;
 begin
  perform public.organon_teams('publish','{"orgId":"91720000-0000-4000-8000-000000000001","module":"books","resourceId":"91740000-0000-4000-8000-000000000001","revision":2,"content":{},"assets":[]}');
  raise exception 'Member replaced another publisher';
 exception when insufficient_privilege then null; end;
 begin
  insert into storage.objects(bucket_id,name,owner_id) values('organon-shared','91720000-0000-4000-8000-000000000001/books/91740000-0000-4000-8000-000000000001/'||repeat('0',64),'91710000-0000-4000-8000-000000000002');
  raise exception 'Member uploaded into another publisher resource';
 exception when insufficient_privilege then null; end;
end $$;
insert into storage.objects(bucket_id,name,owner_id) values('organon-shared','91720000-0000-4000-8000-000000000001/notebooks/91740000-0000-4000-8000-000000000003/'||repeat('0',64),'91710000-0000-4000-8000-000000000002');
select public.organon_teams('publish',jsonb_build_object('orgId','91720000-0000-4000-8000-000000000001','module','notebooks','resourceId','91740000-0000-4000-8000-000000000003','revision',0,'content','{"id":"91740000-0000-4000-8000-000000000003","name":"Member notebook","pages":[]}'::jsonb,'assets',jsonb_build_array('91720000-0000-4000-8000-000000000001/notebooks/91740000-0000-4000-8000-000000000003/'||repeat('0',64))));
do $$ begin
 if not public.organon_can_access_resource('91720000-0000-4000-8000-000000000001','notebooks','91740000-0000-4000-8000-000000000003',true) then raise exception 'Publisher lost own copy'; end if;
 if not exists(select 1 from public.organon_shared_resources where resource_id='91740000-0000-4000-8000-000000000003' and published_by=auth.uid()) then raise exception 'Publisher identity was not trusted'; end if;
end $$;
select set_config('request.jwt.claim.sub','91710000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.organon_shared_resources where org_id='91720000-0000-4000-8000-000000000001') then raise exception 'Outsider can read'; end if;
 begin
  perform public.organon_teams('publish','{"orgId":"91720000-0000-4000-8000-000000000001","module":"notebooks","resourceId":"91740000-0000-4000-8000-000000000004","revision":0,"content":{},"assets":[]}');
  raise exception 'Outsider published';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','91710000-0000-4000-8000-000000000001',true);
do $$ begin
 if not public.organon_can_access_resource('91720000-0000-4000-8000-000000000001','notebooks','91740000-0000-4000-8000-000000000003') then raise exception 'Owner cannot receive member copy'; end if;
 if not exists(select 1 from public.organon_team_notifications where user_id=auth.uid() and member_id='91730000-0000-4000-8000-000000000001' and kind='shared_notebooks') then raise exception 'Owner did not receive publication notice'; end if;
end $$;
select public.organon_teams('revoke','{"orgId":"91720000-0000-4000-8000-000000000001","id":"91730000-0000-4000-8000-000000000001","revision":2}');
select set_config('request.jwt.claim.sub','91710000-0000-4000-8000-000000000002',true);
do $$ begin
 if public.organon_can_access_resource('91720000-0000-4000-8000-000000000001','notebooks','91740000-0000-4000-8000-000000000003') then raise exception 'Revoked member kept access'; end if;
 if organon_private.can_publish('91720000-0000-4000-8000-000000000001','notebooks','91740000-0000-4000-8000-000000000005') then raise exception 'Revoked member can publish'; end if;
end $$;
rollback;
