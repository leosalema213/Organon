import { useEffect, useMemo, useState } from 'react';

export function reviewAttention(collection, now = Date.now()) {
  const decks = new Set(collection?.decks.map(deck => deck.id)), notes = new Set(collection?.notes.map(note => note.id));
  let count = 0, nextAt = Infinity;
  for (const card of collection?.cards || []) {
    if (![1, 2, 3].includes(card.state) || card.suspended || card.unsupported || !decks.has(card.deckId) || !notes.has(card.noteId)) continue;
    const available = Math.max(card.due, card.buriedUntil || 0);
    if (!Number.isFinite(available)) continue;
    if (available <= now) count++;
    else nextAt = Math.min(nextAt, available);
  }
  return { count, nextAt };
}

export default function useAnkiReviewCount(collection) {
  const [now, setNow] = useState(Date.now);
  const attention = useMemo(() => reviewAttention(collection, Math.max(now, Date.now())), [collection, now]);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timeout = Number.isFinite(attention.nextAt) ? setTimeout(refresh, Math.min(2147483647, Math.max(1, attention.nextAt - Date.now()))) : null;
    window.addEventListener('focus', refresh);
    return () => { clearTimeout(timeout); window.removeEventListener('focus', refresh); };
  }, [attention]);
  return attention.count;
}
