-- Organon optional cloud backup. Apply only to the dedicated Organon project.
-- Account profile schema is maintained separately in profile.sql.
create table public.organon_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.organon_sync_state enable row level security;
revoke all on public.organon_sync_state from anon;
grant select, insert, update, delete on public.organon_sync_state to authenticated;
create policy organon_owner_select on public.organon_sync_state for select to authenticated using ((select auth.uid()) = user_id);
create policy organon_owner_insert on public.organon_sync_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy organon_owner_update on public.organon_sync_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy organon_owner_delete on public.organon_sync_state for delete to authenticated using ((select auth.uid()) = user_id);

create function public.organon_commit_snapshot(p_expected_revision integer, p_checksum text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.organon_sync_state; owner uuid := (select auth.uid());
begin
  if owner is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner::text, 0));
  select * into current_row from public.organon_sync_state where user_id = owner;
  if coalesce(current_row.revision, 0) <> p_expected_revision then
    return jsonb_build_object('ok', false, 'current', jsonb_build_object('revision', current_row.revision, 'checksum', current_row.checksum, 'updated_at', current_row.updated_at));
  end if;
  insert into public.organon_sync_state(user_id, revision, checksum, payload) values(owner, p_expected_revision + 1, p_checksum, p_payload)
  on conflict (user_id) do update set revision = excluded.revision, checksum = excluded.checksum, payload = excluded.payload, updated_at = now()
  returning * into current_row;
  return jsonb_build_object('ok', true, 'current', jsonb_build_object('revision', current_row.revision, 'checksum', current_row.checksum, 'updated_at', current_row.updated_at));
end;
$$;
revoke execute on function public.organon_commit_snapshot(integer, text, jsonb) from public, anon;
grant execute on function public.organon_commit_snapshot(integer, text, jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organon-assets', 'organon-assets', false, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream']);
create policy organon_asset_select on storage.objects for select to authenticated using (bucket_id = 'organon-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy organon_asset_insert on storage.objects for insert to authenticated with check (bucket_id = 'organon-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy organon_asset_delete on storage.objects for delete to authenticated using (bucket_id = 'organon-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
