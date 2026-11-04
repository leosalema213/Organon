import { basicModel } from './anki.js';

// The relation is book -> plans -> decks. No direct book/deck link is persisted.
export function bookAnkiDecks(collection, book, plans = []) {
  const existing = new Set(plans.map(plan => plan.id));
  const linked = new Set((book?.planIds || []).filter(id => existing.has(id)));
  return collection.decks.filter(deck => deck.planIds?.some(id => linked.has(id)));
}

export function newAnkiDraft(collection, deckId) {
  const model = collection.models.find(item => item.id === basicModel.id) || basicModel;
  return { id: crypto.randomUUID(), modelId: model.id, fields: model.fields.map(() => ''), tags: [], deckId, isNew: true };
}
