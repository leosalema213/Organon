// The server accepts the next list's ID (null means the end), never an index.
export function listInsertion(columns, movingId, pointerX) {
  return columns.find(column => column.id !== movingId && pointerX < column.left + column.width / 2)?.id ?? null;
}

export function reorderedLists(lists, movingId, beforeId) {
  const moving = lists.find(list => list.id === movingId);
  if (!moving || movingId === beforeId || (beforeId !== null && !lists.some(list => list.id === beforeId))) return lists;
  const next = lists.filter(list => list.id !== movingId);
  const index = beforeId === null ? next.length : next.findIndex(list => list.id === beforeId);
  next.splice(index, 0, moving);
  return next.every((list, i) => list.id === lists[i].id) ? lists : next;
}
