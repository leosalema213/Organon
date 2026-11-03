import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildPlan,sql,canonical,cents}=require('../scripts/migration-financas-plan.cjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const org=id(1),owner=id(2),category=id(3),alias=id(4);
 const snapshot={format:1,source_project:'synthetic',captured_at:'2026-01-01T00:00:00Z',organization:{id:org,name:'Synthetic space',created_at:'2026-01-01T00:00:00Z'},profiles:[],settings:[],kanban_boards:[],kanban_lists:[],kanban_cards:[],kanban_tags:[],kanban_card_tags:[],
  financeiro_types:[{id:alias,org_id:org,name:'  ＣASA ',created_at:'2026-01-02',created_by:owner},{id:category,org_id:org,name:'Casa',created_at:'2026-01-01',created_by:owner}],
  financeiro_entries:[{id:id(5),org_id:org,type_id:category,description:"O'Brien",value:'0.10',entry_type:'entrada',entry_date:'2026-01-01',count_for_mei:true,created_by:owner},{id:id(6),org_id:org,type_id:alias,description:"O'Brien",value:'0.20',entry_type:'entrada',entry_date:'2026-01-01',count_for_mei:true,created_by:owner}]};
 return {snapshot,target:{sourceProject:'synthetic',sourceOrgId:org,ownerId:id(7),ownerEmail:'synthetic@example.invalid'},category,alias};
}
test('migration merges exact category aliases while preserving every legitimate entry and author',()=>{
 const h=fixture(),before=structuredClone(h.snapshot),plan=buildPlan(h.snapshot,h.target);
 assert.equal(plan.counts.categoriesAfter,1);assert.equal(plan.counts.entries,2);assert.equal(plan.categoryAliases[h.alias],h.category);
 const entries=plan.records.filter(r=>r.table==='financeiro_entries');assert.equal(entries.length,2);assert(entries.every(r=>r.row.type_id===h.category));
 assert.equal(entries[0].row.created_by,h.target.ownerId);assert.equal(entries[0].row.source_created_by,id(2));
 assert.equal(plan.totals['2026:entrada'].total,'0.30');assert.deepEqual(h.snapshot,before);
 assert.equal(buildPlan(h.snapshot,h.target).sourceHash,plan.sourceHash);
});
test('migration rejects orphan references and precision loss instead of guessing',()=>{
 const h=fixture();h.snapshot.financeiro_entries[0].type_id=id(90);assert.throws(()=>buildPlan(h.snapshot,h.target),/Missing category/);
 assert.throws(()=>cents('1.001'),/precision/);
});
test('migration SQL scopes account and identities, escapes data and never deletes financial records',()=>{
 const h=fixture(),plan=buildPlan(h.snapshot,h.target),text=sql(plan,h.target);
 assert(text.includes('Destination account mismatch'));assert(text.includes("O''Brien"));assert(text.includes('import_financas_row'));
 assert(!/delete\s+from|truncate|drop\s+table/i.test(text));assert.equal(plan.records.filter(r=>r.sourceTable==='financeiro_types').length,2);
});
test('asset SQL requires matching verified bytes audit and checks Storage before data insertion',()=>{
 const h=fixture(),asset={id:id(20),org_id:id(1),source_project:'synthetic',source_bucket:'avatars',source_name:'photo.png',mime:'image/png',size:8,sha256:'a'.repeat(64),archive_path:id(7)+'/'+'a'.repeat(64)};
 const plan=buildPlan(h.snapshot,h.target,{__archive:[asset]});assert.throws(()=>sql(plan,h.target),/Verified remote/);
 assert.throws(()=>sql(plan,h.target,{ok:true,verified:1,manifestHash:'wrong'}),/Verified remote/);
 const text=sql(plan,h.target,{ok:true,verified:1,manifestHash:plan.assetManifestHash});assert(text.indexOf('storage.objects')<text.indexOf('select organon_private.import_financas_row'));
 assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
});
