-- Private MEI APIs; shared financial grants never authorize these reports/settings.
begin;
create function public.mei_snapshot(p_org_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb;
begin
 if not organon_private.owner(p_org_id) then raise exception 'MEI requires the owner' using errcode='42501'; end if;
 snapshot:=public.financeiro_snapshot(p_org_id);
 return (snapshot-'canWrite')||jsonb_build_object('settings',(
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'orgId',s.org_id,'ownerId',s.owner_id,'year',s.year,'meiLimit',s.mei_limit::text,'createdBy',s.created_by,'revision',s.revision) order by s.year),'[]')
  from public.financeiro_settings s where s.org_id=p_org_id and s.owner_id=auth.uid()
 ));
end; $$;
revoke all on function public.mei_snapshot(uuid) from public,anon;
grant execute on function public.mei_snapshot(uuid) to authenticated;
create function organon_private.mei_mutate(p_org_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); owner uuid; entry public.financeiro_entries; settings public.financeiro_settings; target_year integer;
begin
 if u is null or p_action is null or p_action not in ('saveSettings','createType','createEntry','updateEntry','deleteEntry') or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>1048576 then raise exception 'Invalid MEI request'; end if;
 select owner_id into owner from public.organizations where id=p_org_id for update;
 if owner is distinct from u then raise exception 'MEI requires the owner' using errcode='42501'; end if;
 if p_action='saveSettings' then
  target_year:=(p_payload->>'year')::integer;
  if target_year is null or target_year not between 2001 and 9999 or coalesce(p_payload->>'meiLimit','')!~'^[0-9]+(\.[0-9]+)?$' or char_length(p_payload->>'meiLimit')>200 then raise exception 'Invalid MEI settings'; end if;
  if p_payload->>'id' is not null then
   select * into settings from public.financeiro_settings where id=(p_payload->>'id')::uuid and org_id=p_org_id and owner_id=u for update;
   if not found or settings.revision is distinct from (p_payload->>'expectedRevision')::bigint then return jsonb_build_object('conflict',true); end if;
   if settings.year<>target_year then raise exception 'Settings year is immutable'; end if;
   update public.financeiro_settings set mei_limit=(p_payload->>'meiLimit')::numeric where id=settings.id returning * into settings;
  else
   if exists(select 1 from public.financeiro_settings where org_id=p_org_id and owner_id=u and year=target_year) then return jsonb_build_object('conflict',true); end if;
   insert into public.financeiro_settings(org_id,owner_id,year,mei_limit,created_by) values(p_org_id,u,target_year,(p_payload->>'meiLimit')::numeric,u) returning * into settings;
  end if;
  return jsonb_build_object('ok',true,'settings',jsonb_build_object('id',settings.id,'orgId',settings.org_id,'ownerId',settings.owner_id,'year',settings.year,'meiLimit',settings.mei_limit::text,'createdBy',settings.created_by,'revision',settings.revision));
 end if;
 if p_action in ('updateEntry','deleteEntry') then
  select * into entry from public.financeiro_entries where id=(p_payload->>'id')::uuid and org_id=p_org_id for update;
  if not found or entry.revision is distinct from (p_payload->>'expectedRevision')::bigint then return jsonb_build_object('conflict',true); end if;
  if not(entry.entry_type='projetado' or entry.entry_type='entrada' and entry.count_for_mei) then raise exception 'Entry is outside MEI'; end if;
 end if;
 if p_action in ('createEntry','updateEntry') and coalesce(p_payload->>'entryType','') not in ('entrada','projetado') then raise exception 'Invalid MEI entry nature'; end if;
 return organon_private.financial_mutate(p_org_id,p_action,p_payload);
end; $$;
revoke all on function organon_private.mei_mutate(uuid,text,jsonb) from public,anon;
grant execute on function organon_private.mei_mutate(uuid,text,jsonb) to authenticated;
create function public.mei_mutate(p_org_id uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select organon_private.mei_mutate(p_org_id,p_action,p_payload); $$;
revoke all on function public.mei_mutate(uuid,text,jsonb) from public,anon;
grant execute on function public.mei_mutate(uuid,text,jsonb) to authenticated;
commit;
