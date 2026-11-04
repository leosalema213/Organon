import { useEffect, useRef, useState } from 'react';
import { validBooks } from './books.js';

const progressFields = ['page', 'pageCount', 'furthestPage', 'location', 'fraction', 'furthestFraction', 'view', 'completedAt'];
const progressKey = (userId, book) => `organon.shared-reading.v1:${userId}:${book.orgId}:${book.id}:${book.hash}`;

function restoreProgress(userId, book) {
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey(userId, book)) || 'null');
    const restored = { ...book, ...Object.fromEntries(progressFields.filter(field => Object.hasOwn(saved || {}, field)).map(field => [field, saved[field]])) };
    if (validBooks([restored])) return restored;
  } catch {}
  return book;
}

function saveSharedProgress(userId, book) {
  localStorage.setItem(progressKey(userId, book), JSON.stringify(Object.fromEntries(progressFields.map(field => [field, book[field]]))));
}

export function useSharedBooks(api, userId, spaces) {
  const spaceIds = spaces.map(space => space.id).sort().join(',');
  const scope = `${userId || ''}:${spaceIds}`;
  const [catalog, setCatalog] = useState(null);
  const progress = useRef(new Map());
  const [, renderProgress] = useState(0);
  useEffect(() => {
    if (!api || !userId || !spaceIds) return;
    let sequence = 0;
    async function refresh() {
      const current = ++sequence;
      const results = await Promise.allSettled(spaceIds.split(',').map(async orgId => {
        const rows = await api.call('teams', 'resources', { orgId });
        return rows.filter(row => row.module === 'books').flatMap(row => {
          const { title, hash, size, format } = row.content || {};
          const id = row.resource_id;
          const book = { id, title, hash, size, format, orgId, sharedKey: `${orgId}:${id}:${hash}`,
            planIds: [], page: 1, pageCount: null, furthestPage: 0, completedAt: null, importedAt: new Date().toISOString(),
            view: { spread: 1, zoom: 1, contrast: 'paper' } };
          return validBooks([book]) ? [book] : [];
        });
      }));
      if (current !== sequence) return;
      setCatalog({ scope, books: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
        error: results.some(result => result.status === 'rejected') });
    }
    refresh();
    const unsubscribe = api.subscribe('teams', event => { if (event.type !== 'connection') refresh(); });
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      sequence++;
      unsubscribe();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [api, userId, spaceIds, scope]);
  const current = catalog?.scope === scope ? catalog : null;
  function patch(book, change) {
    const key = progressKey(userId, book);
    const previous = { ...book, ...progress.current.get(key) };
    const updated = typeof change === 'function' ? change(previous) : { ...previous, ...change };
    progress.current.set(key, Object.fromEntries(progressFields.map(field => [field, updated[field]])));
    renderProgress(value => value + 1);
    saveSharedProgress(userId, updated);
  }
  return { books: (current?.books || []).map(book => ({ ...restoreProgress(userId, book), ...progress.current.get(progressKey(userId, book)) })),
    error: current?.error, loading: !!userId && !!spaceIds && !current, patch };
}
