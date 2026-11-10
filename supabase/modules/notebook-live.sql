-- Apply after sharing-recipients.sql (and alongside sharing-resource-permissions.sql).
-- Remote application pending. Existing content, grants and revisions are preserved.
begin;
alter table public.organon_shared_resources
 add column if not exists last_edited_by uuid references auth.users(id) on delete set null,
 add column if not exists last_edited_at timestamptz;

create or replace function organon_private.notebook_edit_stamp()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.module='notebooks' then
  if tg_op='INSERT' or new.content is distinct from old.content then
   new.last_edited_by:=auth.uid();
   new.last_edited_at:=clock_timestamp();
  end if;
 end if;
 return new;
end; $$;
revoke all on function organon_private.notebook_edit_stamp() from public,anon,authenticated;
drop trigger if exists teams_notebook_edit_stamp on public.organon_shared_resources;
create trigger teams_notebook_edit_stamp before insert or update of content on public.organon_shared_resources
 for each row execute function organon_private.notebook_edit_stamp();

-- Edits are already broadcast by teams_shared_changed. Do not fill the inbox on each autosave.
create or replace function organon_private.shared_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record; owner_id uuid; author_member uuid; actor uuid:=auth.uid();
begin
 if tg_op='UPDATE' then return null; end if;
 select o.owner_id into owner_id from public.organizations o where o.id=new.org_id;
 select id into author_member from public.organon_team_members where org_id=new.org_id and user_id=actor and status='accepted';
 for recipient in
  select owner_id as user_id,author_member as member_id where owner_id<>actor
  union all
  select m.user_id,m.id from public.organon_team_members m where m.org_id=new.org_id and m.status='accepted' and m.user_id<>actor and m.user_id<>owner_id
   and (m.user_id=new.published_by or (m.grants->new.module->>'mode'='all' and not coalesce((m.grants->new.module->'excludedIds') ? new.resource_id::text,false)) or (m.grants->new.module->>'mode'='selected' and (m.grants->new.module->'ids') ? new.resource_id::text))
 loop
  if recipient.member_id is not null then insert into public.organon_team_notifications(user_id,member_id,kind) values(recipient.user_id,recipient.member_id,'shared_'||new.module); end if;
 end loop;
 return null;
end; $$;
revoke all on function organon_private.shared_notice() from public,anon,authenticated;
commit;
