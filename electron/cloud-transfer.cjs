// Bound network concurrency and settle every worker before releasing the sync queue.
async function mapTransfers(items, action, concurrency = 3) {
  let cursor = 0, failure;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await action(items[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}
function limitTransfers(action, concurrency = 3) {
  let active = 0;
  const queue = [];
  function drain() {
    while (active < concurrency && queue.length) {
      const { value, resolve, reject } = queue.shift(); active++;
      Promise.resolve().then(() => action(value)).then(resolve, reject).finally(() => { active--; drain(); });
    }
  }
  return value => new Promise((resolve, reject) => { queue.push({ value, resolve, reject }); drain(); });
}
module.exports = { mapTransfers, limitTransfers };
