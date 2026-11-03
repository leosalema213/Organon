const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'test-output','migration-financas');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function stableUuid(value){const chars=hash(value).slice(0,32).split('');chars[12]='5';chars[16]=(parseInt(chars[16],16)&3|8).toString(16);const h=chars.join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function checkImage(bytes,mime){
 if(!bytes.length||bytes.length>5242880)throw new Error('Migration image exceeds the bounded image limit.');
 const valid=mime==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid)throw new Error('Source image signature mismatch.');
}
async function prepare(sourceFile){
 const snapshot=JSON.parse(fs.readFileSync(sourceFile)),target=JSON.parse(fs.readFileSync(path.join(directory,'target.json'))),files=JSON.parse(fs.readFileSync(path.join(directory,'source-assets.json')));
 const host=`https://${target.sourceProject}.supabase.co`,urlFor=f=>host+'/storage/v1/object/public/'+f.bucket+'/'+f.name.split('/').map(encodeURIComponent).join('/');
 const downloaded=new Map(),items=[],mapping={__archive:[]};fs.mkdirSync(path.join(directory,'assets'),{recursive:true});
 for(const file of files){
  if(!['avatars','kanban-board-bgs','kanban-thumbnails'].includes(file.bucket)||file.name.includes('..')||Number(file.size)>5242880)throw new Error('Source asset scope mismatch.');
  const url=urlFor(file),response=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)throw new Error('Cannot copy source asset: HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==Number(file.size))throw new Error('Source asset size changed.');checkImage(bytes,file.mime);
  const sha256=hash(bytes),localFile=path.join(directory,'assets',sha256);if(!fs.existsSync(localFile))fs.writeFileSync(localFile,bytes,{flag:'wx'});
  const entry={sourceUrl:url,sha256,size:bytes.length,mime:file.mime,localFile};downloaded.set(decodeURI(url),entry);
  // Preserve referenced and orphaned domain files privately, without making old URLs a dependency.
  items.push({...entry,bucket:'organon-migration-assets',path:target.ownerId+'/'+sha256});
  mapping.__archive.push({id:stableUuid(target.sourceProject+'/'+file.bucket+'/'+file.name),org_id:target.sourceOrgId,source_project:target.sourceProject,source_bucket:file.bucket,source_name:file.name,mime:file.mime,size:bytes.length,sha256,archive_path:target.ownerId+'/'+sha256});
 }
 const references=[];
 for(const b of snapshot.kanban_boards)if(b.bg_image_url)references.push({url:b.bg_image_url,boardId:b.id});
 const lists=new Map(snapshot.kanban_lists.map(l=>[l.id,l.board_id]));for(const c of snapshot.kanban_cards)if(c.thumbnail_url)references.push({url:c.thumbnail_url,boardId:lists.get(c.list_id)});
 for(const reference of references){
  const parsed=new URL(reference.url);if(parsed.origin!==host)throw new Error('External asset requires explicit review; not fetched.');
  const entry=downloaded.get(decodeURI(reference.url));if(!entry)throw new Error('Referenced asset absent from consistent source manifest.');
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[entry.mime];
  const item={...entry,boardId:reference.boardId,bucket:'organon-kanban',path:target.sourceOrgId+'/'+reference.boardId+'/'+stableUuid(reference.url+'|'+reference.boardId)+'.'+ext};
  mapping[reference.url+'|'+reference.boardId]=item;items.push(item);
 }
 const unique=[...new Map(items.map(i=>[i.bucket+'/'+i.path,i])).values()];
 fs.writeFileSync(path.join(directory,'assets.json'),JSON.stringify(mapping,null,2));fs.writeFileSync(path.join(directory,'asset-jobs.json'),JSON.stringify(unique,null,2));
 console.log(JSON.stringify({downloadedSourceFiles:files.length,uploadObjects:unique.length,referencedImages:references.length,bytes:unique.reduce((s,x)=>s+x.size,0),privateOutput:directory}));
}
async function upload(){
 const config=require('../electron/cloud-config.cjs'),jobs=JSON.parse(fs.readFileSync(path.join(directory,'asset-jobs.json')));
 const email='organon-migration-'+crypto.randomUUID()+'@example.com',password=crypto.randomUUID()+'aA1!';let session;
 async function request(endpoint,options={}){
  const {body,binary,...rest}=options;const response=await fetch(config.url+endpoint,{...rest,headers:{apikey:config.key,...(session?{Authorization:'Bearer '+session.access_token}:{}),...(body&&!Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{}),...options.headers},body:body&&!Buffer.isBuffer(body)?JSON.stringify(body):body,signal:AbortSignal.timeout(45000)});
  if(!response.ok){const error=new Error('Migration transfer HTTP '+response.status);error.status=response.status;throw error;}
  if(binary)return Buffer.from(await response.arrayBuffer());const text=await response.text();return text?JSON.parse(text):null;
 }
 try{
  session=await request('/auth/v1/signup',{method:'POST',body:{email,password}});if(!session?.access_token)throw new Error('Migration identity must have an immediate session.');
  fs.writeFileSync(path.join(directory,'uploader.json'),JSON.stringify({id:session.user.id,email},null,2));
  console.log(JSON.stringify({phase:'awaiting_scoped_storage_grants',uploaderId:session.user.id,email}));
  let granted;const deadline=Date.now()+240000;
  do{granted=await request('/rest/v1/rpc/organon_migration_storage_tasks',{method:'POST',body:{}});if(granted.length)break;await new Promise(resolve=>setTimeout(resolve,2000));}while(Date.now()<deadline);
  if(granted?.length!==jobs.length)throw new Error('Scoped upload manifest was not authorized.');
  for(const job of jobs){
   if(!granted.some(g=>g.bucket===job.bucket&&g.path===job.path&&g.sha256===job.sha256&&g.size===job.size))throw new Error('Server manifest does not match the local copy.');
   const bytes=fs.readFileSync(job.localFile);if(hash(bytes)!==job.sha256)throw new Error('Local asset integrity mismatch.');
   try{await request('/storage/v1/object/'+job.bucket+'/'+job.path,{method:'POST',body:bytes,headers:{'Content-Type':job.mime}});}catch(e){if(e.status!==409&&e.status!==400)throw e;}
   const saved=await request('/storage/v1/object/authenticated/'+job.bucket+'/'+job.path,{binary:true});if(saved.length!==job.size||hash(saved)!==job.sha256)throw new Error('Destination asset integrity mismatch.');
  }
  const {canonical}=require('./migration-financas-plan.cjs');
  const manifest=jobs.map(j=>({bucket:j.bucket,path:j.path,sha256:j.sha256,size:j.size})).sort((a,b)=>(a.bucket+'/'+a.path).localeCompare(b.bucket+'/'+b.path));
  fs.writeFileSync(path.join(directory,'asset-upload-audit.json'),JSON.stringify({ok:true,verified:jobs.length,manifestHash:hash(canonical(manifest)),uploaderId:session.user.id,completedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({phase:'uploaded_and_verified',objects:jobs.length,uploaderId:session.user.id}));
 }finally{if(session?.access_token)await request('/auth/v1/logout?scope=global',{method:'POST'}).catch(()=>{});}
}
if(require.main===module)(async()=>{
 if(fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync(directory)!==directory)throw new Error('Private migration directory must not be a link.');
 if(process.argv[2]==='--prepare')await prepare(path.resolve(process.argv[3]));else if(process.argv[2]==='--upload')await upload();else throw new Error('Use --prepare source.json or --upload.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={stableUuid,checkImage};
