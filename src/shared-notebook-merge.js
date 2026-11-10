// Merge independent edits; a conflicting field must never silently overwrite another person.
export function mergeSharedNotebook(base, local, remote) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function merge(before, mine, theirs, field) {
    if (equal(mine, before)) return theirs;
    if (equal(theirs, before) || equal(mine, theirs)) return mine;
    if (field === 'pages') {
      const previous = new Map(before.map(page => [page.id, page]));
      const mineById = new Map(mine.map(page => [page.id, page]));
      const theirsById = new Map(theirs.map(page => [page.id, page]));
      return [...new Set([...theirsById.keys(), ...mineById.keys()])].flatMap(id => {
        const page = merge(previous.get(id), mineById.get(id), theirsById.get(id), 'page');
        return page ? [page] : [];
      });
    }
    if (before && mine && theirs && !Array.isArray(mine) && typeof mine === 'object' && typeof theirs === 'object') {
      return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(mine), ...Object.keys(theirs)])].map(key => [key, merge(before[key], mine[key], theirs[key], key)]));
    }
    throw new Error('Outra pessoa alterou o mesmo trecho. Seu rascunho foi preservado. Baixe uma cópia do rascunho antes de recarregar.');
  }
  return merge(base, local, remote, 'notebook');
}
