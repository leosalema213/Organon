-- Prepared for a DISPOSABLE/local Supabase database after teams.sql + kanban.sql.
-- Run as database administrator. Synthetic accounts/resources only; always rollback.
-- Never use production as a test fixture. No claim of remote validation.
begin;
create temporary table kanban_fixture as select
 gen_random_uuid() as owner_id,gen_random_uuid() as editor_id,gen_random_uuid() as outsider_id,
 gen_random_uuid() as org_id,gen_random_uuid() as other_org_id,gen_random_uuid() as board_id,
 gen_random_uuid() as hidden_board_id,gen_random_uuid() as other_board_id,
 gen_random_uuid() as list_id,gen_random_uuid() as other_list_id,gen_random_uuid() as card_id,
 gen_random_uuid() as tag_id,gen_random_uuid() as hidden_tag_id;
grant select on kanban_fixture to authenticated;
insert into auth.users(id,email) select owner_id,'kanban-owner-'||owner_id::text||'@example.invalid' from kanban_fixture
 union all select editor_id,'kanban-editor-'||editor_id::text||'@example.invalid' from kanban_fixture
 union all select outsider_id,'kanban-outsider-'||outsider_id::text||'@example.invalid' from kanban_fixture;
insert into public.organizations(id,name,owner_id) select org_id,'Synthetic Kanban',owner_id from kanban_fixture
 union all select other_org_id,'Synthetic Other',outsider_id from kanban_fixture;
insert into public.kanban_boards(id,org_id,name,created_by) select board_id,org_id,'Visible',owner_id from kanban_fixture
 union all select hidden_board_id,org_id,'Hidden',owner_id from kanban_fixture
 union all select other_board_id,other_org_id,'Other organization',outsider_id from kanban_fixture;
insert into public.kanban_lists(id,board_id,name) select list_id,board_id,'Visible column' from kanban_fixture
 union all select other_list_id,other_board_id,'Other column' from kanban_fixture;
insert into public.kanban_cards(id,list_id,title,price,created_by) select card_id,list_id,'Original',0,owner_id from kanban_fixture;
insert into public.kanban_tags(id,org_id,name,created_by) select tag_id,org_id,'Visible marker',owner_id from kanban_fixture
 union all select hidden_tag_id,org_id,'Unlinked hidden marker',owner_id from kanban_fixture;
insert into public.kanban_card_tags(card_id,tag_id) select card_id,tag_id from kanban_fixture;
insert into public.organon_team_members(org_id,user_id,status,grants) select org_id,editor_id,'accepted',
 jsonb_build_object('kanban',jsonb_build_object('mode','selected','ids',jsonb_build_array(board_id),'write',true)) from kanban_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',editor_id,'role','authenticated')::text,true) from kanban_fixture;
set local role authenticated;
do $$ declare f record; response jsonb; failed boolean := false; begin
 select * into f from kanban_fixture;
 if (select count(*) from public.kanban_boards)<>1 then raise exception 'RLS leaked boards'; end if;
 if (select count(*) from public.kanban_tags)<>1 then raise exception 'RLS leaked unlinked markers'; end if;
 begin
  update public.kanban_cards set title='Direct bypass' where id=f.card_id;
 exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Direct writes bypassed CAS'; end if;
 response:=public.organon_kanban('saveCard',f.org_id,jsonb_build_object('boardId',f.board_id,'id',f.card_id,'expectedRevision',1,'listId',f.list_id,'title','Edited','description','<p>🧪</p>','price','0','tagIds',jsonb_build_array(f.tag_id)));
 if response->>'title'<>'Edited' or (response->>'revision')::int<>2 or (response->>'price')::numeric<>0 then raise exception 'Card save incorrect'; end if;
 failed:=false;
 begin
  perform public.organon_kanban('saveCard',f.org_id,jsonb_build_object('boardId',f.board_id,'id',f.card_id,'expectedRevision',1,'listId',f.list_id,'title','Stale overwrite','description','','price',null,'tagIds','[]'::jsonb));
 exception when sqlstate 'PT409' then failed:=true; end;
 if not failed then raise exception 'Stale editor overwrote card'; end if;
 if (select title from public.kanban_cards where id=f.card_id)<>'Edited' or not exists(select 1 from public.kanban_card_tags where card_id=f.card_id and tag_id=f.tag_id) then raise exception 'Conflict modified data or links'; end if;
 failed:=false;
 begin
  perform public.organon_kanban('moveCard',f.org_id,jsonb_build_object('boardId',f.board_id,'id',f.card_id,'expectedRevision',2,'listId',f.other_list_id));
 exception when others then failed:=true; end;
 if not failed then raise exception 'Cross-organization move accepted'; end if;
 failed:=false;
 begin
  perform public.organon_kanban('saveTag',f.org_id,jsonb_build_object('boardId',f.board_id,'name','Unauthorized global tag','color','#123456','icon','Tag'));
 exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Selected member edited organization-wide tags'; end if;
 response:=public.organon_kanban('getBoard',f.org_id,jsonb_build_object('boardId',f.board_id));
 if response->>'canWrite'<>'true' or response->>'canManageTags'<>'false' or jsonb_array_length(response->'cards')<>1 then raise exception 'Snapshot incorrect'; end if;
end $$;
reset role;
-- Read-only grant applies in the database, even when the renderer forges a writable UI.
update public.organon_team_members set grants=jsonb_set(grants,'{kanban,write}','false') where user_id=(select editor_id from kanban_fixture);
set local role authenticated;
do $$ declare f record; failed boolean:=false; begin
 select * into f from kanban_fixture;
 begin
  perform public.organon_kanban('deleteCard',f.org_id,jsonb_build_object('boardId',f.board_id,'id',f.card_id,'expectedRevision',2));
 exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Read-only member deleted a card'; end if;
end $$;
reset role;
update public.organon_team_members set status='revoked' where user_id=(select editor_id from kanban_fixture);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.kanban_boards) or exists(select 1 from public.kanban_cards) or exists(select 1 from public.kanban_tags) then raise exception 'Revoked member retained data access'; end if;
end $$;
reset role;
rollback;
