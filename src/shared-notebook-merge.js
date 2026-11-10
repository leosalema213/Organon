import { documentText, noteDocument } from './note-document.js';

// JSONB may reorder object keys. Only array order and actual values are significant.
export function notebookEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && notebookEqual(a[key], b[key]));
}

// Combine non-overlapping replacements in strings or ordered document blocks.
function combineRanges(before, mine, theirs, equal) {
  function change(after) {
    let start = 0, end = before.length, tail = after.length;
    while (start < end && start < tail && equal(before[start], after[start])) start++;
    while (end > start && tail > start && equal(before[end - 1], after[tail - 1])) { end--; tail--; }
    return { start, end, value: after.slice(start, tail) };
  }
  const a = change(mine), b = change(theirs);
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  if (first.end > second.start || first.start === second.start) return undefined;
  const parts = [before.slice(0, first.start), first.value, before.slice(first.end, second.start), second.value, before.slice(second.end)];
  return typeof before === 'string' ? parts.join('') : parts.flat();
}

// Collect genuine conflicts for an explicit choice, without losing either version.
export function mergeSharedNotebook(base, local, remote, choices = {}) {
  const conflicts = [], equal = notebookEqual;
  function merge(before, mine, theirs, field, path = []) {
    if (equal(mine, before)) return theirs;
    if (equal(theirs, before) || equal(mine, theirs)) return mine;
    if (field === 'pages') {
      const previous = new Map(before.map(page => [page.id, page]));
      const mineById = new Map(mine.map(page => [page.id, page]));
      const theirsById = new Map(theirs.map(page => [page.id, page]));
      return [...new Set([...theirsById.keys(), ...mineById.keys()])].flatMap(id => {
        const page = merge(previous.get(id), mineById.get(id), theirsById.get(id), 'page', [...path, id]);
        return page ? [page] : [];
      });
    }
    if (before && mine && theirs && !Array.isArray(mine) && typeof mine === 'object' && typeof theirs === 'object') {
      // text/images are derived from the rich document, never merged independently.
      const richPage = field === 'page' && (before.document || mine.document || theirs.document);
      if (richPage) {
        before = { ...before, document: noteDocument(before) };
        mine = { ...mine, document: noteDocument(mine) };
        theirs = { ...theirs, document: noteDocument(theirs) };
      }
      const keys = [...new Set([...Object.keys(before), ...Object.keys(mine), ...Object.keys(theirs)])];
      const result = Object.fromEntries(keys.filter(key => !richPage || !['text', 'images'].includes(key)).map(key => [key, merge(before[key], mine[key], theirs[key], key, [...path, key])]));
      if (richPage) { result.text = documentText(result.document); result.images = []; }
      return result;
    }
    if (field === 'text' && typeof before === 'string' && typeof mine === 'string' && typeof theirs === 'string') {
      const combined = combineRanges(before, mine, theirs, equal);
      if (combined !== undefined) return combined;
    }
    if (Array.isArray(before) && Array.isArray(mine) && Array.isArray(theirs)) {
      const combined = combineRanges(before, mine, theirs, equal);
      if (combined !== undefined) return combined;
      if (before.length === mine.length && before.length === theirs.length) return before.map((value, index) => merge(value, mine[index], theirs[index], String(index), [...path, index]));
    }
    const key = JSON.stringify(path);
    if (choices[key] === 'local') return mine;
    if (choices[key] === 'remote') return theirs;
    conflicts.push({ key, path, local: mine, remote: theirs });
    return mine;
  }
  const result = merge(base, local, remote, 'notebook');
  if (conflicts.length) {
    const error = new Error('Há versões diferentes do mesmo trecho. Seu rascunho foi preservado. Compare as versões para sincronizar.');
    error.conflicts = conflicts;
    throw error;
  }
  return result;
}
