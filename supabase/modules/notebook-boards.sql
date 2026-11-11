-- Apply after sharing.sql / sharing-recipients.sql. Remote application pending.
-- Prevent legacy clients from silently stripping unknown board fields on save.
begin;
create or replace function organon_private.protect_notebook_boards()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.module='notebooks' and old.module='notebooks' then
  if exists (
   select 1
   from jsonb_array_elements(case when jsonb_typeof(old.content->'pages')='array' then old.content->'pages' else '[]'::jsonb end) previous
   join jsonb_array_elements(case when jsonb_typeof(new.content->'pages')='array' then new.content->'pages' else '[]'::jsonb end) incoming
    on incoming->>'id'=previous->>'id'
   where previous->>'kind'='board'
    and (incoming->>'kind' is distinct from 'board'
     or jsonb_typeof(incoming->'board') is distinct from 'object'
     or incoming->'board'->>'version' is distinct from '1')
  ) then
   raise exception 'Este caderno contém quadros. Atualize o Organon antes de editar.' using errcode='PT422';
  end if;
 end if;
 return new;
end; $$;
revoke all on function organon_private.protect_notebook_boards() from public,anon,authenticated;
drop trigger if exists teams_protect_notebook_boards on public.organon_shared_resources;
create trigger teams_protect_notebook_boards before update of content on public.organon_shared_resources
 for each row execute function organon_private.protect_notebook_boards();
commit;
