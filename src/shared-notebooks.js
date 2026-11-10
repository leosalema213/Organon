import { useEffect, useState } from 'react';
import { isNotebookColor, notebookIcons } from './book-appearance.js';
import { isNoteImage } from './note-document.js';

export function useSharedNotebooks(api, userId, spaces = []) {
  const spaceIds = spaces.map(space => space.id).sort().join(',');
  const scope = `${userId || ''}:${spaceIds}`;
  const [catalog, setCatalog] = useState(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!api || !userId || !spaceIds) return;
    let sequence = 0;
    async function refresh() {
      const current = ++sequence;
      const results = await Promise.allSettled(spaceIds.split(',').map(async orgId => {
        const rows = await api.call('teams', 'resources', { orgId });
        return rows.filter(row => row.module === 'notebooks' && row.content?.id === row.resource_id && typeof row.content.name === 'string' && Array.isArray(row.content.pages)).map(row => ({
          ...row.content, cover: isNoteImage(row.content.cover) ? row.content.cover : null,
          color: isNotebookColor(row.content.color) ? row.content.color : 'violet', icon: notebookIcons.includes(row.content.icon) ? row.content.icon : 'book',
          orgId, revision: row.revision, publishedBy: row.published_by || spaces.find(space => space.id === orgId)?.owner_id,
        }));
      }));
      if (current !== sequence) return;
      setCatalog({ scope, notebooks: results.flatMap(result => result.status === 'fulfilled' ? result.value : []), error: results.some(result => result.status === 'rejected') });
    }
    refresh();
    const stop = api.subscribe('teams', event => { if (event.type !== 'connection') refresh(); });
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { sequence++; stop(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, [api, userId, spaceIds, scope, retry]);
  const current = catalog?.scope === scope ? catalog : null;
  return { notebooks: current?.notebooks || [], error: current?.error, loading: !!api && !!userId && !!spaceIds && !current, retry: () => setRetry(value => value + 1) };
}
