const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key,item) => item && typeof item==='object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
const normalize = name => name.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('pt-BR');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function cents(value) {
 const match=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
 if(!match) throw new Error('Monetary precision requires explicit review; no rounding performed.');
 return (match[1]?-1n:1n)*(BigInt(match[2])*100n+BigInt((match[3]||'').padEnd(2,'0')));
}
function decimal(value) { const abs=value<0n?-value:value; return (value<0n?'-':'')+(abs/100n)+'.'+String(abs%100n).padStart(2,'0'); }
function totals(entries) {
 const groups=new Map();
 for(const e of entries) {
  const key=e.entry_date.slice(0,4)+':'+e.entry_type;
  const group=groups.get(key)||{count:0,total:0n,mei:0n}; group.count++; group.total+=cents(e.value);
  if(e.entry_type==='projetado'||e.entry_type==='entrada'&&e.count_for_mei)group.mei+=cents(e.value);
  groups.set(key,group);
 }
 return Object.fromEntries([...groups].sort().map(([key,g])=>[key,{count:g.count,total:decimal(g.total),mei:decimal(g.mei)}]));
}
function buildPlan(snapshot,target,assetMap={}) {
 if(snapshot.format!==1||snapshot.source_project!==target.sourceProject||snapshot.organization?.id!==target.sourceOrgId||!UUID.test(target.ownerId))throw new Error('Snapshot/destination scope mismatch.');
 const orgId=target.sourceOrgId,records=[],aliases={},canonicalTypes=[],unresolved=new Set();
 const groups=new Map();
 for(const row of snapshot.financeiro_types) {
  const name=normalize(row.name); if(!name)throw new Error('Empty category requires manual review.');
  const group=groups.get(name)||[]; group.push(row);groups.set(name,group);
 }
 for(const group of groups.values()) {
  group.sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||a.id.localeCompare(b.id));
  canonicalTypes.push(group[0]);for(const row of group)aliases[row.id]=group[0].id;
 }
 const actor=row=>({...row,created_by:row.created_by?target.ownerId:null,source_created_by:row.created_by||null});
 function add(sourceTable,source,row,table=sourceTable,key={id:row.id}) {
  const id=source.id||source.card_id+':'+source.tag_id;
  records.push({sourceTable,sourceId:id,sourceHash:hash(canonical(source)),source,row,table,key});
 }
 function asset(url,boardId) {
  if(!url)return url;
  const entry=assetMap[url+'|'+boardId];
  if(!entry){unresolved.add(url+'|'+boardId);return url;}
  if(entry.bucket!=='organon-kanban'||entry.boardId!==boardId||!entry.path.startsWith(orgId+'/'+boardId+'/')||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Invalid asset migration mapping.');
  return entry.path;
 }
 add('organizations',snapshot.organization,{...snapshot.organization,owner_id:target.ownerId});
 for(const asset of assetMap.__archive||[])add('storage.objects',{...asset,id:asset.source_bucket+'/'+asset.source_name},asset,'organon_legacy_assets');
 for(const p of snapshot.profiles)add('profiles',p,{id:p.id,org_id:orgId,source_project:target.sourceProject,name:p.name,source_role:p.role,source_payload:p,created_at:p.created_at},'organon_legacy_profiles');
 // Canonical categories must exist before alias journal entries and transaction remapping.
 for(const t of canonicalTypes)add('financeiro_types',t,actor(t));
 for(const t of snapshot.financeiro_types.filter(t=>aliases[t.id]!==t.id))add('financeiro_types',t,actor(canonicalTypes.find(c=>c.id===aliases[t.id])));
 for(const e of snapshot.financeiro_entries) {
  cents(e.value);if(e.type_id&&!aliases[e.type_id])throw new Error('Missing category reference.');
  add('financeiro_entries',e,{...actor(e),type_id:e.type_id?aliases[e.type_id]:null});
 }
 for(const s of snapshot.settings){cents(s.mei_limit);add('settings',s,{...actor(s),owner_id:target.ownerId},'financeiro_settings');}
 const boards=new Set(snapshot.kanban_boards.map(b=>b.id)), lists=new Map(snapshot.kanban_lists.map(l=>[l.id,l])), cards=new Set(snapshot.kanban_cards.map(c=>c.id)),tags=new Set(snapshot.kanban_tags.map(t=>t.id));
 for(const b of snapshot.kanban_boards)add('kanban_boards',b,{...actor(b),bg_image_url:asset(b.bg_image_url,b.id)});
 for(const l of snapshot.kanban_lists){if(!boards.has(l.board_id))throw new Error('Missing board reference.');add('kanban_lists',l,l);}
 for(const t of snapshot.kanban_tags)add('kanban_tags',t,actor(t));
 for(const c of snapshot.kanban_cards){if(!lists.has(c.list_id))throw new Error('Missing column reference.');if(c.price!==null&&c.price!==undefined)cents(c.price);add('kanban_cards',c,{...actor(c),thumbnail_url:asset(c.thumbnail_url,lists.get(c.list_id).board_id)});}
 for(const t of snapshot.kanban_card_tags){if(!cards.has(t.card_id)||!tags.has(t.tag_id))throw new Error('Missing tag/card relation.');add('kanban_card_tags',t,t,'kanban_card_tags',{card_id:t.card_id,tag_id:t.tag_id});}
 const identities=new Set();
 for(const r of records){const key=r.sourceTable+':'+r.sourceId;if(identities.has(key))throw new Error('Repeated source identity.');identities.add(key);}
 const assets=[...new Map([
  ...(assetMap.__archive||[]).map(a=>({bucket:'organon-migration-assets',path:a.archive_path,sha256:a.sha256,size:a.size})),
  ...Object.entries(assetMap).filter(([key])=>key!=='__archive').map(([,a])=>({bucket:a.bucket,path:a.path,sha256:a.sha256,size:a.size})),
 ].map(a=>[a.bucket+'/'+a.path,a])).values()].sort((a,b)=>(a.bucket+'/'+a.path).localeCompare(b.bucket+'/'+b.path));
 return {version:1,sourceProject:target.sourceProject,sourceOrgId:orgId,sourceHash:hash(canonical(snapshot)),ownerId:target.ownerId,assets,assetManifestHash:hash(canonical(assets)),
  counts:{entries:snapshot.financeiro_entries.length,categoriesBefore:snapshot.financeiro_types.length,categoriesAfter:canonicalTypes.length,boards:boards.size,lists:lists.size,cards:cards.size},
  totals:totals(snapshot.financeiro_entries),categoryAliases:aliases,unresolvedAssets:[...unresolved],records};
}
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const str=value=>"'"+String(value).replaceAll("'","''")+"'";
function sql(plan,target,audit) {
 if(plan.unresolvedAssets.length)throw new Error('Assets not migrated; refusing an incomplete import.');
 if(!UUID.test(target.ownerId)||target.ownerId!==plan.ownerId)throw new Error('Destination identity mismatch.');
 if(plan.assets.length&&(!audit?.ok||audit.verified!==plan.assets.length||audit.manifestHash!==plan.assetManifestHash))throw new Error('Verified remote asset audit required before generating import SQL.');
 const statements=['begin;',"set local standard_conforming_strings=on;",'select pg_advisory_xact_lock(hashtextextended('+str('migration:'+plan.sourceProject+':'+plan.sourceOrgId)+',0));',
  'do $$ begin if not exists(select 1 from auth.users where id='+str(target.ownerId)+'::uuid and lower(email)='+str(target.ownerEmail.toLowerCase())+') then raise exception \'Destination account mismatch\'; end if; end $$;'];
 for(const asset of plan.assets)statements.push('do $$ begin if not exists(select 1 from storage.objects where bucket_id='+str(asset.bucket)+' and name='+str(asset.path)+" and (metadata->>'size')::bigint="+asset.size+") then raise exception 'Required migrated asset missing or incomplete'; end if; end $$;");
 for(const r of plan.records)statements.push('select organon_private.import_financas_row('+[str(plan.sourceProject),str(r.sourceTable),str(r.sourceId),str(plan.sourceOrgId)+'::uuid',str(r.table),literal(r.key),literal(r.row),literal(r.source),str(r.sourceHash)].join(',')+');');
 statements.push('commit;');return statements.join('\n');
}
function main() {
 const [sourceFile,targetFile,assetFile]=process.argv.slice(2); if(!sourceFile||!targetFile)throw new Error('Use node migration-financas-plan.cjs source.json target.json [assets.json].');
 const snapshot=JSON.parse(fs.readFileSync(sourceFile,'utf8')),target=JSON.parse(fs.readFileSync(targetFile,'utf8'));
 const map=assetFile?JSON.parse(fs.readFileSync(assetFile,'utf8')):{},plan=buildPlan(snapshot,target,map);
 const out=path.resolve(path.dirname(targetFile)),workspace=path.resolve(__dirname,'..'),allowed=path.join(workspace,'test-output','migration-financas');
 if(out!==allowed||fs.lstatSync(out).isSymbolicLink()||fs.realpathSync(out)!==out)throw new Error('Private output must stay in test-output/migration-financas.');
 fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan,null,2));
 const auditFile=path.join(out,'asset-upload-audit.json'),audit=fs.existsSync(auditFile)?JSON.parse(fs.readFileSync(auditFile)):null;
 const verified=!plan.assets.length||audit?.ok&&audit.manifestHash===plan.assetManifestHash&&audit.verified===plan.assets.length;
 if(!plan.unresolvedAssets.length&&verified)fs.writeFileSync(path.join(out,'import.sql'),sql(plan,target,audit));
 else if(fs.existsSync(path.join(out,'import.sql')))fs.unlinkSync(path.join(out,'import.sql'));
 console.log(JSON.stringify({counts:plan.counts,unresolvedAssets:plan.unresolvedAssets.length,assetsVerified:!!verified,privateOutput:out,sourceUnchanged:true,applied:false}));
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={buildPlan,sql,normalize,canonical,totals,cents,decimal};
