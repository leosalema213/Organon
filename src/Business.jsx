import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Columns3, Users, Wallet, BriefcaseBusiness } from 'lucide-react';
import usePlugins from './plugin-system/usePlugins.js';
import NoteEditor from './NoteEditor.jsx';
import { newPage } from './model.js';
import { waitForImages } from './images.js';
import './business.css';
const cleanError=error=>new Error(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));

export function useBusiness(user) {
  const plugins=usePlugins(),[spaces,setSpaces]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState(''),[notices,setNotices]=useState(0);
  const epoch=useRef(0),refreshSequence=useRef(0),listeners=useRef(new Map());
  const syncs=useRef(new Map()),downloads=useRef(new Map()),identity=useRef(user?.id);identity.current=user?.id;
  const api=useMemo(()=>({
    call:async(module,action,payload={})=>{try{if(!window.desktop?.modules)throw new Error('Disponível no aplicativo para Windows.');return await window.desktop.modules.call(module,action,payload);}catch(error){throw cleanError(error);}},
    subscribe:(module,listener)=>{const set=listeners.current.get(module)||new Set();set.add(listener);listeners.current.set(module,set);return()=>set.delete(listener);},
    refresh:()=>{for(const callbacks of listeners.current.values())for(const callback of callbacks)callback({type:'invalidate'});},
    downloadSharedBook:(orgId,resourceId)=>{
      const userId=identity.current,key=`${userId}:${orgId}:${resourceId}`;
      if(downloads.current.has(key))return downloads.current.get(key);
      const job=api.call('teams','downloadBook',{orgId,resourceId}).then(result=>{
        if(identity.current!==userId)throw new Error('A conta mudou. Abra o livro novamente.');
        return result;
      }).finally(()=>downloads.current.delete(key));
      downloads.current.set(key,job);return job;
    },
    syncShared:orgId=>{
      const userId=identity.current,key=`${userId}:${orgId}`;
      if(syncs.current.has(key))return syncs.current.get(key);
      const check=()=>{if(identity.current!==userId)throw new Error('A conta mudou. Sincronize novamente.');};
      const job=(async()=>{
        check();const rows=await api.call('teams','resources',{orgId});check();
        for(const row of rows){
          if(row.module==='books'){check();await api.downloadSharedBook(orgId,row.resource_id);check();}
        }
        return rows;
      })().finally(()=>syncs.current.delete(key));
      syncs.current.set(key,job);return job;
    },
  }),[]);
  useEffect(()=>window.desktop?.modules?.onChanged(event=>{for(const callback of listeners.current.get(event.module)||[])callback(event);}),[]);
  useEffect(()=>{
    const current=++epoch.current;setSpaces([]);setSelected(null);setNotices(0);setError('');
    if(!user?.id)return;
    const refresh=async()=>{const sequence=++refreshSequence.current;try{
      const [spacesResult,inboxResult]=await Promise.allSettled([api.call('teams','list'),api.call('teams','inbox')]);
      if(epoch.current!==current||sequence!==refreshSequence.current)return;
      if(spacesResult.status!=='fulfilled')throw spacesResult.reason;
      const next=spacesResult.value;
      setSpaces(next);setSelected(id=>next.some(s=>s.id===id)?id:next.find(s=>s.owner_id===user.id)?.id||next[0]?.id||null);
      setNotices(inboxResult.status==='fulfilled'?inboxResult.value.unreadCount||0:0);setError('');
    }catch(error){if(epoch.current===current&&sequence===refreshSequence.current)setError(error.message);}};
    refresh();const stop=api.subscribe('teams',event=>{if(event.type!=='connection')refresh();});
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
    return()=>{epoch.current++;stop();window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);};
  },[api,user?.id]);
  const workspace=spaces.find(s=>s.id===selected)||null;
  const installedScope=plugins.installed.map(plugin=>plugin.id).sort().join(':');
  useEffect(()=>{window.desktop?.modules?.watch(workspace?.id||null).catch(error=>setError(cleanError(error).message));},[workspace?.id,user?.id,installedScope]);
  const navigation=[['kanban',Columns3,'Quadros'],['teams',Users,'Equipes'],...plugins.installed.map(p=>[p.id,p.id==='financeiro'?Wallet:BriefcaseBusiness,p.name])];
  return {api,spaces,workspace,select:setSelected,error,notices,plugins,navigation};
}

export function WorkspaceSelector({business}) {
  return <select className="business-space" aria-label="Espaço dos módulos" value={business.workspace?.id||''} onChange={event=>business.select(event.target.value)}><option value="">Selecione um espaço</option>{business.spaces.map(space=><option key={space.id} value={space.id}>{space.name}</option>)}</select>;
}

export function SharedNotebooks({api,user,workspace,onBack,notify}) {
  const [items,setItems]=useState([]),[opened,setOpened]=useState(null),[draft,setDraft]=useState(null),[pageId,setPageId]=useState(null);
  const [editing,setEditing]=useState(false),[stale,setStale]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const editingRef=useRef(false),epoch=useRef(0);editingRef.current=editing;
  const editorRef=useRef();
  const load=useCallback(async()=>{
    const current=++epoch.current;
    if(!user||!workspace){setItems([]);return;}
    const rows=await api.call('teams','resources',{orgId:workspace.id});
    if(current!==epoch.current)return;
    const notebooks=rows.filter(row=>row.module==='notebooks');
    setItems(notebooks);
    setOpened(current=>current&&notebooks.some(row=>row.resource_id===current.resource_id)?current:null);
    return rows;
  },[api,user?.id,workspace?.id]);
  useEffect(()=>{
    setOpened(null);setDraft(null);setEditing(false);setError('');
    load().catch(error=>setError(error.message));
    const stop=api.subscribe('teams',event=>{
      if(event.type==='connection')return;
      if(editingRef.current)setStale(true);
      load().catch(error=>{setItems([]);setOpened(null);setError(error.message);});
    });
    const refresh=()=>load().catch(error=>{setItems([]);setOpened(null);setError(error.message);});
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
    return()=>{epoch.current++;stop();window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);};
  },[load,api]);
  async function synchronize(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      await api.syncShared(workspace.id);await load();
      notify('Compartilhados atualizados. Livros autorizados baixados.');
    }catch(error){setError(error.message);}finally{setBusy(false);}
  }
  async function open(row){
    setError('');setBusy(true);
    try{
      const result=await api.call('teams','openResource',{orgId:workspace.id,module:'notebooks',resourceId:row.resource_id});
      setOpened(result);setDraft(structuredClone(result.content));setPageId(result.content.pages[0]?.id||null);setEditing(false);setStale(false);
    }catch(error){setError(error.message);}finally{setBusy(false);}
  }
  async function save(){
    setBusy(true);setError('');
    try{await waitForImages();await api.call('teams','editResource',{orgId:workspace.id,module:'notebooks',resourceId:opened.resource_id,revision:opened.revision,content:draft});setEditing(false);setOpened(null);setDraft(null);setStale(false);await load();notify('Caderno compartilhado salvo.');}
    catch(error){setError(error.message);}finally{setBusy(false);}
  }
  const note=draft?.pages.find(page=>page.id===pageId);
  return <section className="shared-page"><header className="page-heading"><div><button className="secondary" onClick={onBack}><ArrowLeft size={14}/>Voltar</button><h1>Cadernos compartilhados</h1><p>Recursos publicados neste espaço e autorizados para sua conta.</p></div>{user&&workspace&&<button className="secondary" disabled={busy} onClick={synchronize}>{busy?'Sincronizando…':'Sincronizar compartilhados'}</button>}</header>
    {!user?<p>Entre na sua conta para acessar os compartilhados.</p>:!workspace?<p>Selecione um espaço ou aceite um convite no sininho de notificações.</p>:<>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="shared-resource-list">{items.map(row=><button className="secondary" key={row.resource_id} disabled={busy} onClick={()=>open(row)}>{row.content.name||row.content.title}</button>)}</div>
      {!items.length&&<p className="muted">Nenhum recurso compartilhado disponível neste espaço.</p>}
      {opened&&draft&&<section className="shared-notebook"><header><h2>{draft.name}</h2>{opened.canWrite&&!editing&&<button className="secondary" onClick={()=>setEditing(true)}>Editar caderno</button>}{editing&&<><button className="secondary" disabled={busy} onClick={()=>{setEditing(false);setDraft(structuredClone(opened.content));}}>Descartar alterações</button><button className="primary" disabled={busy} onClick={save}>{busy?'Salvando…':'Salvar alterações'}</button></>}</header>
        {editing&&<p className="muted">Rascunho: salve as alterações antes de sair deste caderno.</p>}{stale&&<p role="status">O recurso mudou em outro lugar. Seu rascunho está preservado; o salvamento verificará a revisão.</p>}
        <div className="shared-page-tabs">{draft.pages.map(page=><button className="secondary" key={page.id} onClick={()=>setPageId(page.id)}>{page.title||'Página sem título'}</button>)}{editing&&<button className="secondary" onClick={()=>{const page=newPage();setDraft(current=>({...current,pages:[...current.pages,page]}));setPageId(page.id);}}>Adicionar página</button>}</div>
        {note&&<><input aria-label="Título da página compartilhada" maxLength={200} value={note.title} disabled={!editing||busy} onChange={event=>setDraft(current=>current?({...current,pages:current.pages.map(page=>page.id===note.id?{...page,title:event.target.value}:page)}):current)}/><NoteEditor key={note.id} ref={editorRef} note={note} disabled={!editing||busy} notify={notify} onChange={changes=>setDraft(current=>current?({...current,pages:current.pages.map(page=>page.id===note.id?{...page,...changes}:page)}):current)}/></>}
      </section>}
    </>}
  </section>;
}
