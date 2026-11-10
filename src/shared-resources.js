// Both entry points use the same ownership and identity rules.
export function resourceShares(rows, module, resource, userId, ownerId) {
  const copies = rows.filter(row => row.module === module && (row.resource_id === resource.id ||
    (module === 'books' && row.content?.hash === resource.hash)));
  const own = copies.filter(row => (row.published_by || ownerId) === userId);
  return { own, other: copies.length > own.length };
}

export async function removeResourceShares(api, orgId, module, copies, active = () => true) {
  for (const copy of copies) {
    if (!active()) return;
    await api.call('teams', 'unpublish', { orgId, module, resourceId: copy.resource_id, revision: copy.revision });
  }
}

export function shareChanges(spaces, entries, resources, selected, module, userId) {
  return spaces.flatMap(space => {
    const entry = entries?.get(space.id);
    if (!entry || entry.error || !Object.hasOwn(selected, space.id)) return [];
    return resources.flatMap(resource => {
      const shares = resourceShares(entry.rows, module, resource, userId, space.owner_id);
      return (selected[space.id] ? !shares.own.length && !shares.other : shares.own.length > 0)
        ? [{ space, resource, own: shares.own, publish: selected[space.id] }] : [];
    });
  });
}

export function notebookLibrary(personal, shared) {
  const entries = new Map(personal.map(notebook => [notebook.id, { notebook, orgIds: new Set() }]));
  for (const notebook of shared) {
    const entry = entries.get(notebook.id);
    if (!entry) entries.set(notebook.id, { notebook, orgIds: new Set([notebook.orgId]) });
    else {
      entry.orgIds.add(notebook.orgId);
      if (entry.notebook.orgId && notebook.revision > entry.notebook.revision) entry.notebook = notebook;
    }
  }
  return [...entries.values()];
}

export function personalNotebookCopy(content) {
  // Retain stable IDs to merge the received publication with its independent local copy.
  const { id, name, icon, color, cover, pages } = content;
  return structuredClone({ id, name, icon, color, cover, pages });
}
