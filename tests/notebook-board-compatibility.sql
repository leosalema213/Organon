-- Run after supabase/modules/notebook-boards.sql. Synthetic temp rows only; rollback.
begin;
create temporary table board_compatibility_test(module text, content jsonb);
create trigger test_protect_boards before update of content on board_compatibility_test
 for each row execute function organon_private.protect_notebook_boards();
insert into board_compatibility_test values ('notebooks','{"pages":[{"id":"p","kind":"board","board":{"version":1,"elements":[],"files":{}}}]}');
do $$
begin
 begin
  update board_compatibility_test set content='{"pages":[{"id":"p","text":"legacy"}]}';
  raise exception 'Legacy write was not rejected';
 exception when sqlstate 'PT422' then null;
 end;
end; $$;
update board_compatibility_test set content=jsonb_set(content,'{pages,0,title}','"Mapa"');
do $$ begin
 if (select content->'pages'->0->>'title' from board_compatibility_test) is distinct from 'Mapa' then
  raise exception 'Current client could not edit the board title';
 end if;
end; $$;
-- Explicit page removal is still supported.
update board_compatibility_test set content='{"pages":[]}';
rollback;
