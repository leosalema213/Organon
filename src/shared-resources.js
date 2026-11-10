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

export function shareChanges(spaces, entries, resources, selected, module, userId, recipients = {}) {
  return spaces.flatMap(space => {
    const entry = entries?.get(space.id);
    if (!entry || entry.error || (!Object.hasOwn(selected, space.id) && !Object.hasOwn(recipients, space.id))) return [];
    return resources.flatMap(resource => {
      const shares = resourceShares(entry.rows, module, resource, userId, space.owner_id);
      const publish = selected[space.id] ?? true;
      const audience = entry.audiences?.[resource.id];
      const recipientIds = audience && Object.hasOwn(recipients, space.id)
        ? audience.members.filter(member => member.fixed || recipients[space.id] === null || recipients[space.id].includes(member.user_id)).map(member => member.user_id) : undefined;
      const audienceChanged = recipientIds && (audience.copies || [audience]).some(copy => copy.members.some(member => !!member.selected !== recipientIds.includes(member.user_id)));
      return (publish ? !shares.other && (!shares.own.length || audienceChanged) : shares.own.length > 0)
        ? [{ space, resource, own: shares.own, publish, ...(recipientIds ? { recipientIds } : {}) }] : [];
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
