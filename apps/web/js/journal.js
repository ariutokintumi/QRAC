// Signer journal: the local record of which one-time keys (leaves) have been used.
//
// Rules (see vitácora D-0.8):
//  - A leaf is RESERVED and persisted BEFORE the signature is computed.
//  - A reserved leaf is never released: not on failure, not on revert, not on page reload.
//  - nextLeaf only moves forward; importing an older journal never moves it back.
//  - The exported journal contains NO secrets (the 24 words are never written into it).
//  - Several browser tabs are serialized with the Web Locks API.

const KEY = 'qrac.v1.journal';
const SEED_KEY = 'qrac.v1.mnemonic';
const TREE_PREFIX = 'qrac.v1.tree.';
const SETTINGS_KEY = 'qrac.v1.settings';

export const RENEWAL_RESERVE = 8; // last leaves of each tree are kept for ROTATE only

function emptyJournal() {
  return { version: 1, accounts: {}, log: [] };
}

export function loadJournal() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || 'null');
    return j && j.version === 1 ? j : emptyJournal();
  } catch {
    return emptyJournal();
  }
}

export function saveJournal(j) {
  localStorage.setItem(KEY, JSON.stringify(j));
}

export function accountId(chainId, accountIndex) {
  return `${chainId}:${accountIndex}`;
}

/** Run fn(journal) under a cross-tab lock, re-reading the journal inside the lock and saving after. */
export async function withJournal(fn) {
  const run = async () => {
    const j = loadJournal();
    const result = await fn(j);
    saveJournal(j);
    return result;
  };
  if (navigator.locks && navigator.locks.request) return navigator.locks.request('qrac-signer-journal', run);
  return run();
}

/** Reserve the next leaf of (account, epoch). Persisted before returning. */
export async function reserveLeaf(accId, epoch, kind, capacity, meta) {
  return withJournal((j) => {
    const acct = j.accounts[accId];
    if (!acct) throw new Error('unknown account in journal');
    if (acct.locked) throw new Error('signing is locked for this account: ' + acct.locked);
    const tree = acct.trees[epoch];
    if (!tree) throw new Error(`no key tree for epoch ${epoch}`);
    const limit = kind === 2 /* ROTATE */ ? capacity : capacity - RENEWAL_RESERVE;
    if (tree.nextLeaf >= limit) {
      throw new Error(kind === 2
        ? 'this key tree is exhausted'
        : `only the ${RENEWAL_RESERVE} renewal keys are left: rotate to a new key tree first`);
    }
    const leaf = tree.nextLeaf;
    tree.nextLeaf = leaf + 1;
    const entry = {
      id: `${accId}:${epoch}:${leaf}`, accountId: accId, epoch, leaf, kind, status: 'reserved',
      createdAt: new Date().toISOString(), ...meta,
    };
    j.log.push(entry);
    return entry;
  });
}

export async function updateEntry(id, patch) {
  return withJournal((j) => {
    const e = j.log.find((x) => x.id === id);
    if (!e) throw new Error('journal entry not found: ' + id);
    Object.assign(e, patch, { updatedAt: new Date().toISOString() });
    return e;
  });
}

/** Merge an imported journal: union of entries, nextLeaf = max(local, imported). Never moves backwards. */
export async function importJournal(data) {
  if (!data || data.version !== 1 || !data.accounts) throw new Error('not a QRAC journal (version 1)');
  return withJournal((j) => {
    for (const [id, inc] of Object.entries(data.accounts)) {
      const cur = j.accounts[id];
      if (!cur) {
        j.accounts[id] = { ...inc, locked: null };
        continue;
      }
      if (inc.address && !cur.address) cur.address = inc.address;
      cur.currentEpoch = Math.max(cur.currentEpoch || 0, inc.currentEpoch || 0);
      for (const [ep, t] of Object.entries(inc.trees || {})) {
        if (!cur.trees[ep]) cur.trees[ep] = { ...t };
        else cur.trees[ep].nextLeaf = Math.max(cur.trees[ep].nextLeaf, t.nextLeaf);
      }
      cur.locked = null; // the user supplied their latest journal
    }
    const ids = new Set(j.log.map((e) => e.id));
    for (const e of data.log || []) if (!ids.has(e.id)) j.log.push(e);
    // Any leaf seen in the log is burned, whatever the trees say.
    for (const e of j.log) {
      const t = j.accounts[e.accountId]?.trees?.[e.epoch];
      if (t && t.nextLeaf <= e.leaf) t.nextLeaf = e.leaf + 1;
    }
    return j;
  });
}

export function exportJournalBlob() {
  const j = loadJournal();
  const out = { ...j, exportedAt: new Date().toISOString(), note: 'QRAC signer journal. Contains no secrets. Keep the LATEST copy.' };
  return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function downloadJournal() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  downloadBlob(exportJournalBlob(), `qrac-journal-${ts}.json`);
}

// ---- DEV MODE secret storage (24 words in localStorage, never exported) --------------------

export function loadMnemonic() {
  return localStorage.getItem(SEED_KEY);
}
export function saveMnemonic(m) {
  localStorage.setItem(SEED_KEY, m);
}
export function forgetMnemonic() {
  localStorage.removeItem(SEED_KEY);
}

// ---- key-tree cache (public data only: tree nodes, rebuildable from the seed) ---------------

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
export function cacheTree(chainId, idx, epoch, T) {
  try { localStorage.setItem(`${TREE_PREFIX}${chainId}.${idx}.${epoch}`, b64(T)); } catch { /* quota: rebuild later */ }
}
export function cachedTree(chainId, idx, epoch) {
  const v = localStorage.getItem(`${TREE_PREFIX}${chainId}.${idx}.${epoch}`);
  return v ? unb64(v) : null;
}

export function loadSettings() {
  try { return { autoDownload: true, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; } catch { return { autoDownload: true }; }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function wipeAll() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('qrac.v1.')) localStorage.removeItem(k);
}
