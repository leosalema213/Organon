import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Users, Wallet, BriefcaseBusiness } from 'lucide-react';
import usePlugins from './plugin-system/usePlugins.js';
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
