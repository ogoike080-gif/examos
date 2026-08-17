// Lightweight localStorage-backed cache for practice/study question sets.
// Lets students keep practicing on a saved set when their connection drops —
// scoring already happens entirely client-side, so no server round-trip is
// needed once a set has been cached.

const PREFIX = 'examos-offline-qset:';
const MAX_SETS = 12; // cap how many distinct sets we keep, oldest evicted first

export function writeOfflineCache(key, questions) {
  try {
    const entry = { questions, savedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
    trimOldSets();
  } catch {
    // Storage full or unavailable — fail silently, offline cache is a bonus not a requirement
  }
}

export function readOfflineCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return entry.questions || null;
  } catch {
    return null;
  }
}

export function listOfflineCacheKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

function trimOldSets() {
  const keys = listOfflineCacheKeys();
  if (keys.length <= MAX_SETS) return;
  const withTimes = keys.map(k => {
    try { return { k, t: JSON.parse(localStorage.getItem(k))?.savedAt || 0 }; }
    catch { return { k, t: 0 }; }
  }).sort((a, b) => a.t - b.t);
  const toRemove = withTimes.slice(0, withTimes.length - MAX_SETS);
  toRemove.forEach(({ k }) => localStorage.removeItem(k));
}
