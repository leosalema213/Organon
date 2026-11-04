import React, { useEffect, useState } from 'react';

// Separate copies: the trusted main resolves each ID from the local personal catalog.
export default function Sharing({ api, orgId, userId, ownerId, busy, run }) {
  const [catalog, setCatalog] = useState({}), [published, setPublished] = useState([]), [error, setError] = useState('');
  async function load() {
    const [c, p] = await Promise.all([api.call('teams', 'catalog', { orgId }), api.call('teams', 'resources', { orgId })]);
    setCatalog(c); setPublished(p);
  }
  useEffect(() => {
    let alive = true;
    const refresh = async () => { try { const [c, p] = await Promise.all([api.call('teams', 'catalog', { orgId }), api.call('teams', 'resources', { orgId })]); if (alive) { setCatalog(c); setPublished(p); setError(''); } } catch (e) { if (alive) setError(e.message); } };
    refresh(); const off = api.subscribe('teams', refresh);
    return () => { alive = false; off(); };
  }, [api, orgId]);
  const ownCopies = published.filter(row => (row.published_by || ownerId) === userId);
  return <section className="teams-section"><h2>Cópias compartilhadas</h2><p>Publique cada caderno ou livro separadamente. Atualizar a cópia preserva o original pessoal. “Todos” abrange as cópias atuais e futuras do espaço.</p>
    {error && <p role="alert" className="teams-error">{error}</p>}
    {['notebooks', 'books'].map(module => <div key={module}><h3>{module === 'notebooks' ? 'Cadernos' : 'Livros'}</h3>
      {(catalog[module] || []).map(item => {
        const copy = ownCopies.find(r => r.module === module && r.resource_id === item.id);
        return <article className="teams-row" key={item.id}><span>{item.name}</span><div className="teams-actions"><button className="secondary" disabled={busy} onClick={() => run(async () => { await api.call('teams', 'publish', { orgId, module, resourceId: item.id, revision: copy?.revision || 0 }); await load(); }, 'Cópia publicada.')}>{copy ? 'Atualizar cópia' : 'Publicar cópia'}</button>{copy && <button className="secondary" disabled={busy} onClick={() => run(async () => { await api.call('teams', 'unpublish', { orgId, module, resourceId: item.id, revision: copy.revision }); await load(); }, 'Cópia removida do espaço.')}>Parar compartilhamento</button>}</div></article>;
      })}
      {ownCopies.filter(r => r.module === module && !(catalog[module] || []).some(i => i.id === r.resource_id)).map(copy => <article className="teams-row" key={copy.resource_id}><span>Cópia sem original local · {copy.resource_id}</span><button className="secondary" disabled={busy} onClick={() => run(async () => { await api.call('teams', 'unpublish', { orgId, module, resourceId: copy.resource_id, revision: copy.revision }); await load(); })}>Parar compartilhamento</button></article>)}
    </div>)}
  </section>;
}
