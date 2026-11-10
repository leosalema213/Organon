// Keep remote edits out of local undo and map selections through only the changed range.
export function remoteNoteTransaction(state, next) {
  const previous = state.doc, start = previous.content.findDiffStart(next.content);
  if (start === null) return null;
  const end = previous.content.findDiffEnd(next.content);
  const overlap = Math.max(0, start - Math.min(end.a, end.b));
  return state.tr.replace(start, end.a + overlap, next.slice(start, end.b + overlap)).setMeta('preventUpdate', true).setMeta('addToHistory', false);
}
