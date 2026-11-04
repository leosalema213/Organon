import { createEmptyCard, fsrs } from 'ts-fsrs';

export const DAY = 86400000;
export const defaultOptions = {
  newPerDay: 20, reviewsPerDay: 200, learnSteps: [1, 10], relearnSteps: [10], graduating: 1, easyInterval: 4,
  initialEase: 2.5, easyBonus: 1.3, hardInterval: 1.2, intervalModifier: 1, newInterval: 0, maxInterval: 36500, minInterval: 1,
  leechThreshold: 8, leechAction: 'tag', insertion: 0, gather: 0, newSort: 0, newMix: 0, interdayMix: 0, reviewOrder: 0,
  buryNew: false, buryReview: false, buryInterday: false, autoplay: true, skipQuestion: false,
  maxAnswerSeconds: 60, showTimer: false, stopTimer: false, questionSeconds: 0, answerSeconds: 0, waitAudio: true,
  questionAction: 0, answerAction: 0, retention: 0.9, weights: [], easyDays: [1, 1, 1, 1, 1, 1, 1],
};
export const emptyAnki = () => ({ version: 1, decks: [], notes: [], cards: [], models: [], presets: [{ id: 'default', name: 'Default', options: { ...defaultOptions } }], media: {}, reviews: [], settings: { fsrs: false, rollover: 4, learnAhead: 20, newIgnoreReview: false, limitsFromTop: false } });
export function normalizePresets(a) {
  if (!a) return emptyAnki();
  const local = a.presets.find(p => p.id === 'default'), imported = a.presets.find(p => p.id !== 'default' && p.name.trim().toLowerCase() === 'default');
  const semantic = options => JSON.stringify(Object.keys(defaultOptions).map(k => {
    const value = options?.[k] ?? defaultOptions[k]; return typeof value === 'number' ? Math.round(value * 100000) / 100000 : value;
  }));
  const removeLocal = local && imported && ((!a.decks.some(d => d.presetId === 'default') && semantic(local.options) === semantic(defaultOptions)) || semantic(local.options) === semantic(imported.options));
  const names = new Set();
  const presets = a.presets.filter(p => !removeLocal || p.id !== 'default').map(p => {
    const base = p.name.trim() || 'Preset'; let name = base, i = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${base} (${i++})`;
    names.add(name.toLocaleLowerCase());
    return { ...p, name, ...(removeLocal && p.id === imported.id ? { aliases: [...new Set([...(p.aliases || []), 'default'])] } : {}) };
  });
  const decks = a.decks.map(d => ({ ...d, planIds: d.planIds || [], ...(removeLocal && d.presetId === 'default' ? { presetId: imported.id } : {}) }));
  return { ...a, presets, decks, settings: { ...a.settings, learnAhead: a.settings.learnAhead ?? 20 } };
}
export const basicModel = { id: 'organon-basic', name: 'Básico', fields: ['Front', 'Back'], kind: 0, css: '', templates: [{ name: 'Card 1', q: '{{Front}}', a: '{{FrontSide}}<hr>{{Back}}' }] };
export const reversedModel = { ...basicModel, id: 'organon-reverse', name: 'Básico e invertido', templates: [...basicModel.templates, { name: 'Card 2', q: '{{Back}}', a: '{{FrontSide}}<hr>{{Front}}' }] };
export const clozeModel = { id: 'organon-cloze', name: 'Omissão (cloze)', fields: ['Text', 'Back Extra'], kind: 1, css: '', templates: [{ name: 'Cloze', q: '{{cloze:Text}}', a: '{{cloze:Text}}<hr>{{Back Extra}}' }] };
export function studyDay(now = Date.now(), rollover = 4) { const d = new Date(now); d.setHours(d.getHours() - rollover); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function dayStart(now = Date.now(), rollover = 4) { const d = new Date(`${studyDay(now, rollover)}T00:00:00`); d.setHours(rollover); return d.getTime(); }
export function afterDays(now, days, rollover = 4) { const d = new Date(dayStart(now, rollover)); d.setDate(d.getDate() + days); return d.getTime(); }
export function optionsFor(a, deck, now = Date.now()) {
  const day = studyDay(now, a.settings.rollover);
  return { ...defaultOptions, ...a.presets.find(p => p.id === deck.presetId)?.options, ...deck.options, ...(deck.today?.day === day ? deck.today.options : {}) };
}
const hash = value => { let n = 2166136261; for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
export function deckCards(a, deckId) { const deck = a.decks.find(d => d.id === deckId); return a.cards.filter(c => c.deckId === deckId || a.decks.some(d => d.id === c.deckId && d.name.startsWith(deck?.name + '::'))); }
export function removeDeck(a, deckId) {
  const deck = a.decks.find(d => d.id === deckId); if (!deck) return a;
  const removed = new Set(a.decks.filter(d => d.id === deckId || d.name.startsWith(deck.name + '::')).map(d => d.id));
  const affectedNotes = new Set(a.cards.filter(c => removed.has(c.deckId)).map(c => c.noteId));
  const cards = a.cards.filter(c => !removed.has(c.deckId)), referenced = new Set(cards.map(c => c.noteId));
  return { ...a, decks: a.decks.filter(d => !removed.has(d.id)), cards, notes: a.notes.filter(n => !affectedNotes.has(n.id) || referenced.has(n.id)) };
}
export function queue(a, deckId, now = Date.now()) {
  const root = a.decks.find(d => d.id === deckId); if (!root) return [];
  const day = studyDay(now, a.settings.rollover), start = dayStart(now, a.settings.rollover), opts = optionsFor(a, root, now);
  const cards = deckCards(a, deckId).filter(c => !c.suspended && (!c.buriedUntil || c.buriedUntil <= now) && !c.unsupported);
  const daily = a.reviews.filter(r => r.at >= start), used = new Map();
  const candidates = cards.filter(c => c.state === 0 || c.due <= now);
  // Future intraday learners come only after all eligible cards in the regular queue.
  // Keep their stored due time intact; the window affects availability, not scheduling.
  const cutoff = now + (a.settings.learnAhead ?? 20) * 60000, tomorrow = afterDays(now, 1, a.settings.rollover);
  const ahead = cards.filter(c => [1, 3].includes(c.state) && c.due > now && c.due <= cutoff && c.due < tomorrow).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
  const rank = c => c.state === 0 ? opts.newMix === 1 ? 3 : opts.newMix === 2 ? -1 : 1 : c.state === 1 || c.state === 3 ? c.due >= start ? -2 : opts.interdayMix === 1 ? 2 : opts.interdayMix === 2 ? -1 : 1 : 1;
  const random = c => hash(`${day}:${c.id}`);
  const gather = c => opts.gather === 2 ? -c.position : opts.gather === 3 || opts.gather === 5 ? hash(day + c.noteId) : opts.gather === 4 ? random(c) : c.position;
  const deckName = c => a.decks.find(d => d.id === c.deckId)?.name || '';
  candidates.sort((a, b) => {
    const r = rank(a) - rank(b); if (r) return r;
    if (a.state === 0 && b.state === 0) {
      if ([0, 2].includes(opts.newSort) && a.ord !== b.ord) return a.ord - b.ord;
      if ([2, 4].includes(opts.newSort)) return random(a) - random(b);
      if (opts.newSort === 3) return hash(day + a.noteId) - hash(day + b.noteId) || a.ord - b.ord;
      if ([0, 5].includes(opts.gather)) return deckName(a).localeCompare(deckName(b)) || gather(a) - gather(b);
      return gather(a) - gather(b);
    }
    if (a.state === 2 && b.state === 2) {
      const order = opts.reviewOrder;
      if (order === 8) return random(a) - random(b);
      if (order === 3 || order === 4) return (a.interval - b.interval) * (order === 4 ? -1 : 1);
      if (order === 5 || order === 6) return (a.ease - b.ease) * (order === 6 ? -1 : 1);
      if (order === 9 || order === 10) return (a.position - b.position) * (order === 10 ? -1 : 1);
      if (order === 1) return a.due - b.due || deckName(a).localeCompare(deckName(b)) || random(a) - random(b);
      if (order === 2) return deckName(a).localeCompare(deckName(b)) || a.due - b.due || random(a) - random(b);
      return a.due - b.due || random(a) - random(b);
    }
    // Deterministic interleaving, stable throughout this study day.
    return random(a) - random(b);
  });
  const ready = candidates.filter(c => {
    if (c.state === 1 || c.state === 3) return true;
    const deck = a.decks.find(d => d.id === c.deckId), ancestors = a.decks.filter(d => deck.name === d.name || deck.name.startsWith(d.name + '::'));
    const limited = a.settings.limitsFromTop ? ancestors : ancestors.filter(d => d.id === deckId || d.id === c.deckId);
    for (const d of limited) {
      const o = optionsFor(a, d, now), ids = new Set(deckCards(a, d.id).map(x => x.id));
      const history = daily.filter(r => ids.has(r.cardId));
      const n = history.filter(r => r.previousState === 0).length, v = history.filter(r => r.previousState === 2).length;
      const u = used.get(d.id) || { n: 0, v: 0 };
      const reservedReviews = Math.min(Math.max(0, o.reviewsPerDay - v), candidates.filter(x => x.state === 2 && ids.has(x.id)).length);
      if (c.state === 0 && (u.n + n >= o.newPerDay || (!a.settings.newIgnoreReview && u.n + n + v + reservedReviews >= o.reviewsPerDay))) return false;
      if (c.state === 2 && u.v + v >= o.reviewsPerDay) return false;
    }
    for (const d of limited) { const u = used.get(d.id) || { n: 0, v: 0 }; u[c.state === 0 ? 'n' : 'v']++; used.set(d.id, u); }
    return true;
  });
  return [...ready, ...ahead];
}
export function counts(a, deckId, now = Date.now()) { const q = queue(a, deckId, now); return { new: q.filter(c => c.state === 0).length, learn: q.filter(c => [1, 3].includes(c.state)).length, due: q.filter(c => c.state === 2).length }; }
export function cardCreatedAt(card) {
  const valid = value => Number.isSafeInteger(value) && value >= 1e12 && value <= Date.now();
  if (valid(card.createdAt)) return card.createdAt;
  const imported = Number(card.source?.id);
  if (valid(imported)) return imported;
  if (!card.source && valid(card.position)) return card.position;
  return null;
}
export function cardCreatedOn(card, day) {
  const timestamp = cardCreatedAt(card);
  if (timestamp === null) return false;
  const date = new Date(timestamp);
  const localDay = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return localDay === day;
}
export function newCard(noteId, deckId, ord = 0, position = Date.now()) { return { id: crypto.randomUUID(), noteId, deckId, ord, position, createdAt: Date.now(), state: 0, due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, step: 0, suspended: false }; }
export function schedule(a, card, rating, now = Date.now()) {
  const deck = a.decks.find(d => d.id === card.deckId), o = optionsFor(a, deck, now);
  const c = { ...card, reps: card.reps + 1, lastReview: now }, rollover = a.settings.rollover;
  let fsrsInterval;
  if (a.settings.fsrs) {
    const parameters = { request_retention: o.retention, maximum_interval: o.maxInterval, enable_fuzz: false, enable_short_term: true };
    if (o.weights?.length) parameters.w = o.weights;
    const f = fsrs(parameters), previous = { ...createEmptyCard(new Date(card.due || now)), ...(card.state === 2 && !card.fsrs ? { stability: Math.max(0.1, card.interval), difficulty: 5 } : {}), ...card.fsrs, state: card.state, reps: card.reps, lapses: card.lapses, scheduled_days: card.interval, learning_steps: card.step, due: new Date(card.due || now), ...(card.lastReview ? { last_review: new Date(card.lastReview) } : {}) };
    const result = f.next(previous, new Date(now), rating).card;
    c.fsrs = { ...result, due: result.due.getTime(), ...(result.last_review ? { last_review: result.last_review.getTime() } : {}) };
    fsrsInterval = Math.max(1, result.scheduled_days);
  }
  function graduate(interval) {
    c.state = 2; c.step = 0; c.interval = Math.max(1, Math.min(o.maxInterval, Math.round(interval)));
    // Local Easy Days policy: choose the closest day with the greatest configured weight,
    // within +/- 5% (at least one day). This is deliberately documented separately from Anki fuzz.
    if (c.interval >= 3 && o.easyDays?.length === 7 && o.easyDays.some(x => x < 1)) {
      const window = Math.max(1, Math.floor(c.interval * 0.05)), target = c.interval; let best = target, score = -Infinity;
      for (let n = Math.max(2, target - window); n <= Math.min(o.maxInterval, target + window); n++) {
        const weekday = new Date(afterDays(now, n, rollover)).getDay(), weight = o.easyDays[(weekday + 6) % 7];
        const value = weight * 100 - Math.abs(n - target); if (value > score) { score = value; best = n; }
      }
      c.interval = best;
    }
    c.due = afterDays(now, c.interval, rollover);
  }
  if (card.state !== 2) {
    const relearn = card.state === 3, steps = relearn ? o.relearnSteps : o.learnSteps;
    c.ease = card.state === 0 ? o.initialEase : card.ease;
    c.state = relearn ? 3 : 1;
    c.step = rating === 1 ? 0 : rating === 3 ? card.state === 0 ? 1 : card.step + 1 : card.step;
    if (rating === 4 || !steps.length || c.step >= steps.length) graduate(fsrsInterval ?? (relearn ? Math.max(o.minInterval, card.interval) : rating === 4 ? o.easyInterval : o.graduating));
    else {
      const minutes = rating === 2 ? card.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[Math.min(card.step, steps.length - 1)] * 1.5 : steps[c.step];
      c.due = now + minutes * 60000;
    }
  } else if (rating === 1) {
    c.lapses++; c.ease = Math.max(1.3, c.ease - 0.2); c.interval = Math.min(o.maxInterval, fsrsInterval ?? Math.max(o.minInterval, Math.round(card.interval * o.newInterval)));
    c.state = o.relearnSteps.length ? 3 : 2; c.step = 0;
    c.due = o.relearnSteps.length ? now + o.relearnSteps[0] * 60000 : afterDays(now, c.interval, rollover);
    if (o.leechThreshold && c.lapses >= o.leechThreshold && o.leechAction === 'suspend') c.suspended = true;
  } else {
    const late = Math.max(0, (dayStart(now, rollover) - card.due) / DAY);
    const hard = Math.max(card.interval + 1, card.interval * o.hardInterval * o.intervalModifier);
    const good = Math.max(hard + 1, (card.interval + late / 2) * card.ease * o.intervalModifier);
    const easy = Math.max(good + 1, (card.interval + late) * card.ease * o.easyBonus * o.intervalModifier);
    graduate(fsrsInterval ?? (rating === 2 ? hard : rating === 3 ? good : easy));
    if (rating === 2) c.ease = Math.max(1.3, c.ease - 0.15); if (rating === 4) c.ease += 0.15;
  }
  return c;
}
export function answer(a, cardId, rating, elapsedMs, now = Date.now()) {
  const old = a.cards.find(c => c.id === cardId); if (!old || ![1, 2, 3, 4].includes(rating)) throw new Error('Resposta inválida.');
  const o = optionsFor(a, a.decks.find(d => d.id === old.deckId), now), next = schedule(a, old, rating, now);
  const cards = a.cards.map(c => c.id === old.id ? next : c.noteId === old.noteId && ((c.state === 0 && o.buryNew) || (c.state === 2 && o.buryReview) || ([1, 3].includes(c.state) && c.due >= afterDays(now, 1, a.settings.rollover) && o.buryInterday)) ? { ...c, buriedUntil: afterDays(now, 1, a.settings.rollover) } : c);
  return { ...a, cards, notes: a.notes.map(n => n.id === old.noteId && next.lapses >= o.leechThreshold && o.leechThreshold && !n.tags.includes('leech') ? { ...n, tags: [...n.tags, 'leech'] } : n), reviews: [...a.reviews, { id: crypto.randomUUID(), cardId, at: now, rating, previousState: old.state, interval: next.interval, elapsedMs: Math.min(Math.max(0, elapsedMs), o.maxAnswerSeconds * 1000) }] };
}
export function mergeAnki(a, imported) {
  // Reimport preserves subsequent Organon edits and reviews. Source IDs remain stable.
  const merge = key => [...a[key], ...imported[key].filter(x => !a[key].some(y => y.id === x.id))];
  return normalizePresets({ ...a, decks: merge('decks'), notes: merge('notes'), cards: merge('cards'), models: merge('models'), presets: merge('presets'), reviews: merge('reviews'), media: { ...imported.media, ...a.media }, sourceMedia: { ...a.sourceMedia, ...imported.sourceMedia }, settings: a.cards.length || a.decks.length ? a.settings : imported.settings });
}
export function validAnki(a) {
  if (!a || a.version !== 1 || !a.settings || !Number.isInteger(a.settings.rollover) || a.settings.rollover < 0 || a.settings.rollover > 23 || !a.media || typeof a.media !== 'object' || Array.isArray(a.media)) return false;
  if (['fsrs', 'newIgnoreReview', 'limitsFromTop'].some(k => typeof a.settings[k] !== 'boolean')) return false;
  if (a.settings.learnAhead !== undefined && (!Number.isInteger(a.settings.learnAhead) || a.settings.learnAhead < 0 || a.settings.learnAhead > 1440)) return false;
  for (const key of ['decks', 'notes', 'cards', 'models', 'presets', 'reviews']) if (!Array.isArray(a[key]) || new Set(a[key].map(x => x?.id)).size !== a[key].length || a[key].some(x => !x || typeof x.id !== 'string' || !x.id)) return false;
  const ids = key => new Set(a[key].map(x => x.id)), decks = ids('decks'), notes = ids('notes'), models = ids('models'), presets = ids('presets');
  if (a.decks.some(d => typeof d.name !== 'string' || !d.name.trim() || !presets.has(d.presetId) || (d.planIds !== undefined && (!Array.isArray(d.planIds) || d.planIds.some(id => typeof id !== 'string' || !id) || new Set(d.planIds).size !== d.planIds.length)))) return false;
  if (a.models.some(m => !Array.isArray(m.fields) || m.fields.some(f => typeof f !== 'string') || !Array.isArray(m.templates) || m.templates.some(t => typeof t.q !== 'string' || typeof t.a !== 'string') || typeof m.css !== 'string')) return false;
  if (a.notes.some(n => !models.has(n.modelId) || !Array.isArray(n.fields) || n.fields.some(f => typeof f !== 'string') || !Array.isArray(n.tags) || n.tags.some(t => typeof t !== 'string'))) return false;
  if (a.cards.some(c => !decks.has(c.deckId) || !notes.has(c.noteId) || ![0, 1, 2, 3].includes(c.state) || ![c.due, c.interval, c.ease, c.reps, c.lapses, c.step, c.ord, c.position].every(Number.isFinite) || c.interval < 0 || c.step < 0 || c.ord < 0 || c.due > 8.64e15 || (c.fsrs && (!Number.isFinite(c.fsrs.stability) || !Number.isFinite(c.fsrs.difficulty) || c.fsrs.stability <= 0 || c.fsrs.difficulty <= 0)))) return false;
  if (a.reviews.some(r => typeof r.cardId !== 'string' || !Number.isFinite(r.at) || !Number.isFinite(r.elapsedMs))) return false;
  if (Object.values(a.media).some(m => !m || !/^[a-f0-9]{64}$/.test(m.hash) || !Number.isInteger(m.size) || m.size < 1 || m.size > 32 * 1024 * 1024 || !/^(audio\/(mpeg|wav|ogg|mp4|flac)|image\/(png|jpeg|webp|gif))$/.test(m.mime))) return false;
  return a.presets.every(p => typeof p.name === 'string' && validOptions(p.options) && (p.aliases === undefined || (Array.isArray(p.aliases) && p.aliases.every(id => typeof id === 'string')))) && a.decks.every(d => (!d.options || validOptions(d.options, true)) && (!d.today || (typeof d.today.day === 'string' && validOptions(d.today.options, true))));
}
export function validOptions(o, partial = false) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const value = { ...defaultOptions, ...o };
  for (const [k, max] of Object.entries({ insertion: 1, gather: 5, newSort: 4, newMix: 2, interdayMix: 2, reviewOrder: 12, questionAction: 1, answerAction: 4 })) if (!Number.isInteger(value[k]) || value[k] < 0 || value[k] > max) return false;
  for (const k of ['buryNew', 'buryReview', 'buryInterday', 'autoplay', 'skipQuestion', 'showTimer', 'stopTimer', 'waitAudio']) if (typeof value[k] !== 'boolean') return false;
  for (const k of ['newPerDay', 'reviewsPerDay', 'graduating', 'easyInterval', 'maxInterval', 'minInterval', 'leechThreshold', 'maxAnswerSeconds']) if (!Number.isInteger(value[k]) || value[k] < 0 || value[k] > 1000000) return false;
  for (const k of ['initialEase', 'easyBonus', 'hardInterval', 'intervalModifier', 'newInterval', 'retention', 'questionSeconds', 'answerSeconds']) if (!Number.isFinite(value[k]) || value[k] < 0) return false;
  if (value.retention <= 0 || value.retention >= 1 || value.maxInterval < 1 || value.initialEase < 1.3) return false;
  for (const k of ['learnSteps', 'relearnSteps', 'weights', 'easyDays']) if (!Array.isArray(value[k]) || value[k].some(n => !Number.isFinite(n) || n < 0) || value[k].length > 30) return false;
  return ['learnSteps', 'relearnSteps'].every(k => value[k].every(n => n > 0 && n <= 525600)) && ['tag', 'suspend'].includes(value.leechAction) && value.easyDays.length === 7 && value.easyDays.every(n => n >= 0 && n <= 1) && (!value.weights.length || [17, 19, 21].includes(value.weights.length));
}
