// QRAC.me dApp (Phase 1 PoC): plain ES modules, no build step, no backend.
import * as E from './eth.js';
import { loadWordlist, generateMnemonic, mnemonicToEntropy, mnemonicToSeed, normalizeMnemonic } from './bip39.js';
import { deriveTree } from './derive.js';
import * as lms from './lms.js';
import * as enc from './encoding.js';
import * as J from './journal.js';

const $ = (id) => document.getElementById(id);
const LMS_TYPE = lms.LMS_SHA256_M32_H10;
const OTS_TYPE = lms.LMOTS_SHA256_N32_W4;
const CAPACITY = 1024;
const EXPLORERS = { '11155111': 'https://sepolia.etherscan.io' };

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];
const erc20 = new E.Interface(ERC20_ABI);

const S = {
  words: null, mnemonic: null, bip39Seed: null,
  provider: null, signer: null, submitter: null, chainId: null, mode: null,
  art: {}, accountIface: null,
  current: null, batch: [], pending: null, signed: null,
  trees: new Map(), settings: J.loadSettings(),
};

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  $('log').textContent = line + $('log').textContent;
}
function revertData(e) {
  return e?.data ?? e?.info?.error?.data ?? e?.error?.data ?? e?.revert?.data ?? null;
}
function explain(e) {
  const data = revertData(e);
  if (typeof data === 'string' && data.length >= 10 && S.accountIface) {
    try {
      const pe = S.accountIface.parseError(data);
      if (pe) return `${pe.name}(${pe.args.map((a) => String(a)).join(', ')})`;
    } catch { /* not an account error */ }
    try { return 'reverted: ' + E.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10))[0]; } catch { /* raw */ }
  }
  // Wallet errors that ethers cannot classify ("could not coalesce error") keep the wallet's own
  // message nested inside; show that instead.
  const inner = e?.error?.message || e?.info?.error?.message || e?.cause?.message || e?.payload?.error?.message;
  const outer = e?.shortMessage || e?.reason || e?.message || String(e);
  if (inner && /coalesce/i.test(outer)) return `wallet error: ${inner}`;
  return outer;
}
async function guard(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    log(`${label} failed: ${explain(e)}`);
    alert(`${label} failed:\n${explain(e)}`);
    return undefined;
  }
}
function short(a) {
  return a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '';
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function txLink(hash) {
  const base = EXPLORERS[S.chainId];
  return base ? `<a href="${base}/tx/${hash}" target="_blank">${short(hash)}</a>` : `<code>${short(hash)}</code>`;
}
function addrLink(a) {
  const base = EXPLORERS[S.chainId];
  return base ? `<a href="${base}/address/${a}" target="_blank"><code>${a}</code></a>` : `<code>${a}</code>`;
}
function jsonable(header) {
  return Object.fromEntries(Object.entries(header).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
}
function currentAccount() {
  return S.current ? J.loadJournal().accounts[S.current] : null;
}
function accountContract(address, runner) {
  return new E.Contract(address, S.art.QRACAccount.abi, runner || S.provider);
}
function requireConnected() {
  if (!S.provider || !S.chainId) throw new Error('connect a network first (Setup tab → Connect)');
}
function requireSeed() {
  if (!S.bip39Seed) throw new Error('load or create your 24-word seed first (Setup tab)');
}
function requireAttached() {
  const a = currentAccount();
  if (!a || !a.address) throw new Error('select a deployed QRAC.me account first (Account tab)');
  return a;
}
async function chainNow() {
  return Number((await S.provider.getBlock('latest')).timestamp);
}

// ---------------------------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------------------------

function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (name === 'activity') renderActivity();
}
$('tabs').addEventListener('click', (e) => e.target.dataset.tab && showTab(e.target.dataset.tab));

// ---------------------------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------------------------

function renderWords(el, mnemonic) {
  el.innerHTML = mnemonic.split(' ').map((w, i) => `<span><i>${i + 1}</i>${esc(w)}</span>`).join('');
}

async function loadSeed(m) {
  S.mnemonic = m;
  S.bip39Seed = await mnemonicToSeed(m);
  $('seedFp').textContent = E.keccak256(S.bip39Seed).slice(0, 18);
  $('seedNone').classList.add('hidden');
  $('seedSome').classList.remove('hidden');
}

function downloadSeedFile() {
  const fp = $('seedFp').textContent;
  const out = {
    qrac: 'seed-v1',
    warning: 'SECRET. Whoever has this file controls the QRAC.me accounts derived from it. Test networks only.',
    mnemonic: S.mnemonic,
    words: 24,
    bip39Passphrase: '',
    fingerprint: fp,
    createdAt: new Date().toISOString(),
  };
  J.downloadBlob(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), `qrac-seed-${fp.slice(2, 10)}.json`);
}

async function useSeed(m, how) {
  m = normalizeMnemonic(m);
  mnemonicToEntropy(m, S.words); // validates count, words and checksum
  J.saveMnemonic(m);
  await loadSeed(m);
  log(`${how}. Stored in this browser (developer mode).`);
}

async function newSeed() {
  if (S.mnemonic && !confirm('Replace the current seed in this browser?')) return;
  await useSeed(generateMnemonic(S.words), 'New 24-word seed created');
  downloadSeedFile();
  log('Seed file downloaded (keep it secret; you need it to restore).');
}
$('btnNewSeed').onclick = () => guard('Create seed', newSeed);
$('btnDownloadSeed').onclick = () => downloadSeedFile();
$('btnShowImport').onclick = () => $('importBox').classList.toggle('hidden');
$('btnImportSeed').onclick = () => guard('Import', async () => {
  await useSeed($('importWords').value, 'Seed imported from typed words');
  $('importWords').value = '';
  log('For accounts with past activity, also import your latest journal before signing.');
});
async function importSeedFile(f) {
  const text = (await f.text()).trim();
  let m = text;
  if (text.startsWith('{')) {
    const data = JSON.parse(text);
    if (data.qrac !== 'seed-v1' || !data.mnemonic) throw new Error('not a QRAC.me seed file');
    m = data.mnemonic;
  }
  await useSeed(m, `Seed imported from ${f.name}`);
  log('For accounts with past activity, also import your latest journal before signing.');
}
$('fileSeed').onchange = (ev) => guard('Import seed file', async () => {
  const f = ev.target.files[0];
  if (!f) return;
  ev.target.value = '';
  await importSeedFile(f);
});
$('btnRevealSeed').onclick = () => {
  const el = $('revealWords');
  if (el.classList.toggle('hidden')) el.innerHTML = '';
  else renderWords(el, S.mnemonic);
};
$('btnForgetSeed').onclick = () => {
  if (!confirm('Remove the 24 words from this browser? Without them (or a backup) you lose control of your QRAC.me accounts.')) return;
  J.forgetMnemonic();
  location.reload();
};

// ---------------------------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------------------------

$('netMode').onchange = () => $('localSignerBox').classList.toggle('hidden', $('netMode').value !== 'local');

/** Wallet events are a convenience only. Some wallets (e.g. Brave) expose a locked Proxy whose
 *  `on` property throws when read, so failures here must never break the connection. */
let walletEventsHooked = false;
function subscribeWalletEvents() {
  if (walletEventsHooked) return;
  walletEventsHooked = true;
  try {
    const eth = window.ethereum;
    const on = eth && typeof eth.on === 'function' ? eth.on.bind(eth) : null;
    if (!on) return;
    on('chainChanged', () => location.reload());
    on('accountsChanged', () => connect().catch((e) => log(explain(e))));
  } catch (e) {
    log('Wallet change events unavailable in this wallet (switching account or network needs a manual "Connect").');
  }
}

async function connect() {
  S.chainId = null; // only set once the connection fully succeeded
  S.mode = $('netMode').value;
  if (S.mode === 'injected') {
    if (!window.ethereum) throw new Error('no browser wallet found (install MetaMask or use the local dev node)');
    S.provider = new E.BrowserProvider(window.ethereum);
    await S.provider.send('eth_requestAccounts', []);
    S.signer = await S.provider.getSigner();
    subscribeWalletEvents();
  } else {
    S.provider = new E.JsonRpcProvider(location.origin + '/rpc', undefined, { batchMaxCount: 1 });
    const info = await S.provider.send('qrac_devInfo', []);
    const sel = $('localSigner');
    if (!sel.options.length) {
      const names = ['deployer / funder', 'relayer', 'recipient', 'attacker', 'fresh EOA'];
      sel.innerHTML = info.accounts.map((a, i) => `<option value="${a}">#${i} ${names[i] || 'test EOA'} · ${short(a)}</option>`).join('');
      sel.onchange = () => connect().catch((e) => log(explain(e)));
    }
    S.signer = await S.provider.getSigner(sel.value);
    S.devInfo = info;
    // the dev node is a fresh chain: always use its pre-deployed shared contracts
    S.settings.verifiers = { ...(S.settings.verifiers || {}), [info.chainId]: info.verifier };
    if (info.factory) S.settings.factories = { ...(S.settings.factories || {}), [info.chainId]: info.factory };
    J.saveSettings(S.settings);
  }
  S.submitter = await S.signer.getAddress();
  S.chainId = (await S.provider.getNetwork()).chainId.toString();
  const known = S.known?.[S.chainId] || {};
  if (known.verifier && !S.settings.verifiers?.[S.chainId]) {
    S.settings.verifiers = { ...(S.settings.verifiers || {}), [S.chainId]: known.verifier };
  }
  if (known.factory && !S.settings.factories?.[S.chainId]) {
    S.settings.factories = { ...(S.settings.factories || {}), [S.chainId]: known.factory };
  }
  J.saveSettings(S.settings);
  const bal = await S.provider.getBalance(S.submitter);
  $('netPill').textContent = `chain ${S.chainId} · ${short(S.submitter)}`;
  $('netPill').className = 'pill ok';
  $('netInfo').innerHTML = `
    <dt>Chain ID</dt><dd>${S.chainId}${S.mode === 'local' ? ' (local dev node)' : ''}</dd>
    <dt>Gas-paying wallet</dt><dd>${addrLink(S.submitter)}</dd>
    <dt>Its balance</dt><dd>${E.formatEther(bal)} ETH</dd>`;
  $('verifierAddr').value = S.settings.verifiers?.[S.chainId] || '';
  $('factoryAddr').value = S.settings.factories?.[S.chainId] || '';
  log(`Connected: chain ${S.chainId}, gas payer ${S.submitter}`);
  renderAccountSelect();
  await refresh();
}
$('btnConnect').onclick = () => guard('Connect', connect);

$('btnSaveVerifier').onclick = () => guard('Save verifier', async () => {
  requireConnected();
  const a = E.getAddress($('verifierAddr').value.trim());
  if ((await S.provider.getCode(a)) === '0x') throw new Error('no contract at that address on this chain');
  S.settings.verifiers = { ...(S.settings.verifiers || {}), [S.chainId]: a };
  J.saveSettings(S.settings);
  log(`Verifier for chain ${S.chainId}: ${a}`);
});
$('btnDeployVerifier').onclick = () => guard('Deploy verifier', async () => {
  requireConnected();
  const f = new E.ContractFactory(S.art.LMSVerifier.abi, S.art.LMSVerifier.bytecode, S.signer);
  log('Deploying LMSVerifier… confirm in your wallet.');
  const c = await f.deploy();
  await c.waitForDeployment();
  const a = await c.getAddress();
  $('verifierAddr').value = a;
  S.settings.verifiers = { ...(S.settings.verifiers || {}), [S.chainId]: a };
  J.saveSettings(S.settings);
  log(`LMSVerifier deployed at ${a}`);
});

function factoryAddress() {
  return S.settings.factories?.[S.chainId] || null;
}
function factoryContract(runner) {
  const f = factoryAddress();
  if (!f) throw new Error('set or deploy the factory first (Setup tab)');
  return new E.Contract(f, S.art.QRACFactory.abi, runner || S.provider);
}

$('btnSaveFactory').onclick = () => guard('Save factory', async () => {
  requireConnected();
  const a = E.getAddress($('factoryAddr').value.trim());
  if ((await S.provider.getCode(a)) === '0x') throw new Error('no contract at that address on this chain');
  const v = await new E.Contract(a, S.art.QRACFactory.abi, S.provider).verifier();
  const mine = S.settings.verifiers?.[S.chainId];
  if (mine && v.toLowerCase() !== mine.toLowerCase()) log(`Note: this factory uses verifier ${v}, not ${mine}.`);
  S.settings.factories = { ...(S.settings.factories || {}), [S.chainId]: a };
  J.saveSettings(S.settings);
  log(`Factory for chain ${S.chainId}: ${a}`);
  await updatePredicted();
});
$('btnDeployFactory').onclick = () => guard('Deploy factory', async () => {
  requireConnected();
  const verifier = S.settings.verifiers?.[S.chainId];
  if (!verifier) throw new Error('set or deploy the verifier first');
  const f = new E.ContractFactory(S.art.QRACFactory.abi, S.art.QRACFactory.bytecode, S.signer);
  log('Deploying QRACFactory (it also deploys the shared, locked account logic)… confirm in your wallet.');
  const c = await f.deploy(verifier);
  await c.waitForDeployment();
  const a = await c.getAddress();
  $('factoryAddr').value = a;
  S.settings.factories = { ...(S.settings.factories || {}), [S.chainId]: a };
  J.saveSettings(S.settings);
  log(`QRACFactory deployed at ${a} (implementation ${await c.implementation()})`);
  await updatePredicted();
});

/** Show the account's address before it exists (CREATE2 prediction from the public key). */
async function updatePredicted() {
  const el = $('predictedAddr');
  const a = currentAccount();
  if (!a || a.address) return;
  if (!S.provider || !factoryAddress()) {
    el.textContent = 'connect and set the factory to see it';
    return;
  }
  const f = factoryContract();
  const pk = a.trees[0].publicKey;
  const [addr, minted] = await Promise.all([f.predictAddress(pk), f.isMinted(pk)]);
  const balance = await S.provider.getBalance(addr);
  el.innerHTML = `${addrLink(addr)} ${minted ? '<span class="pill ok">minted</span>' : '<span class="pill warn">not minted yet</span>'}
    <span class="small muted">· balance ${E.formatEther(balance)} ETH</span>`;
}

// ---------------------------------------------------------------------------------------------
// key trees
// ---------------------------------------------------------------------------------------------

function buildInWorker(I, seed, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./lms-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => {
      if (ev.data.progress !== undefined) { onProgress?.(ev.data.progress); return; }
      w.terminate();
      ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data);
    };
    w.postMessage({ id: 1, lmsType: LMS_TYPE, otsType: OTS_TYPE, I, seed });
  });
}

/** Secret-bearing tree material for (chain, index, epoch). Tree nodes are cached; secrets stay in memory. */
async function getTree(chainId, idx, epoch, progressEl) {
  requireSeed();
  const key = `${chainId}.${idx}.${epoch}`;
  if (S.trees.has(key)) return S.trees.get(key);
  const { seed, I } = await deriveTree(S.bip39Seed, BigInt(chainId), idx, epoch);
  let T = J.cachedTree(chainId, idx, epoch);
  if (!T) {
    const bar = progressEl?.querySelector('div');
    progressEl?.classList.remove('hidden');
    const res = await buildInWorker(I, seed, (p) => { if (bar) bar.style.width = `${(p * 100).toFixed(0)}%`; });
    T = res.T;
    J.cacheTree(chainId, idx, epoch, T);
    log(`Key tree (chain ${chainId}, account #${idx}, epoch ${epoch}) built in ${(res.ms / 1000).toFixed(2)} s.`);
    progressEl?.classList.add('hidden');
  }
  const publicKey = E.hexlify(lms.publicKey(LMS_TYPE, OTS_TYPE, I, T));
  const tree = { seed, I, T, publicKey };
  S.trees.set(key, tree);
  return tree;
}

// ---------------------------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------------------------

function renderAccountSelect() {
  const j = J.loadJournal();
  const list = Object.values(j.accounts).filter((a) => a.chainId === S.chainId).sort((a, b) => a.accountIndex - b.accountIndex);
  const sel = $('acctSelect');
  sel.innerHTML = list.length
    ? list.map((a) => `<option value="${a.id}">#${a.accountIndex} · ${a.address ? short(a.address) : 'not deployed yet'}</option>`).join('')
    : '<option value="">(none yet)</option>';
  if (S.current && list.some((a) => a.id === S.current)) sel.value = S.current;
  else S.current = list[0]?.id || null;
  $('acctIndex').value = list.length ? Math.max(...list.map((a) => a.accountIndex)) + 1 : 0;
  const a = currentAccount();
  $('deployBox').classList.toggle('hidden', !a || !!a.address);
  if (a && !a.address) {
    $('pubKeyOut').value = a.trees[0].publicKey;
    updatePredicted().catch((e) => log('Address prediction failed: ' + explain(e)));
  }
}
$('acctSelect').onchange = () => {
  S.current = $('acctSelect').value || null;
  renderAccountSelect();
  refresh();
};

async function genTree(idx) {
  requireConnected();
  requireSeed();
  if (!Number.isInteger(idx) || idx < 0) throw new Error('account number must be 0 or more');
  const id = J.accountId(S.chainId, idx);
  $('treeStatus').textContent = 'Building 1,024 one-time keys in a background worker…';
  const tree = await getTree(S.chainId, idx, 0, $('treeProgress'));
  await J.withJournal((j) => {
    j.accounts[id] ??= {
      id, chainId: S.chainId, accountIndex: idx, address: null, lmsType: LMS_TYPE, otsType: OTS_TYPE,
      currentEpoch: 0, trees: { 0: { I: E.hexlify(tree.I), publicKey: tree.publicKey, nextLeaf: 0 } }, locked: null,
    };
  });
  S.current = id;
  $('treeStatus').textContent = `Account #${idx}: key tree ready. Public key below.`;
  renderAccountSelect();
  $('pubKeyOut').value = tree.publicKey;
  return id;
}
$('btnGenTree').onclick = () => guard('Key generation', () => genTree(Number($('acctIndex').value)));

$('btnDeployAccount').onclick = () => guard('Deploy account', async () => {
  requireConnected();
  const a = currentAccount();
  if (!a) throw new Error('generate a key tree first');
  const verifier = S.settings.verifiers?.[S.chainId];
  if (!verifier) throw new Error('set or deploy the shared verifier first (Setup tab)');
  const f = new E.ContractFactory(S.art.QRACAccount.abi, S.art.QRACAccount.bytecode, S.signer);
  log('Deploying QRACAccount… confirm in your wallet. The deploying wallet gets no rights over it.');
  const c = await f.deploy(verifier, a.trees[0].publicKey);
  await c.waitForDeployment();
  await attach(await c.getAddress());
});

async function mintCurrent() {
  requireConnected();
  const a = currentAccount();
  if (!a) throw new Error('generate a key tree first');
  const pk = a.trees[0].publicKey;
  const f = factoryContract(S.signer);
  const predicted = await f.predictAddress(pk);
  if (!(await f.isMinted(pk))) {
    log('Minting your QRAC.me account… confirm in your wallet. The minting wallet gets no rights over it.');
    const tx = await f.mint(pk);
    const r = await tx.wait();
    log(`Minted ${predicted} in block ${r.blockNumber}, gas used ${r.gasUsed} (tx ${tx.hash}).`);
  } else {
    log(`Account ${predicted} was already minted; attaching.`);
  }
  await attach(predicted);
  return predicted;
}
$('btnMint').onclick = () => guard('Mint', mintCurrent);

async function attach(address) {
  requireConnected();
  requireSeed();
  const a = currentAccount();
  if (!a) throw new Error('generate (or select) the matching local account first');
  address = E.getAddress(address);
  if ((await S.provider.getCode(address)) === '0x') throw new Error('no contract at that address');
  const c = accountContract(address);
  const [pk, epoch, nonce] = await Promise.all([c.publicKey(), c.epoch(), c.nonce()]);
  const ep = Number(epoch);
  const tree = await getTree(S.chainId, a.accountIndex, ep, $('treeProgress'));
  if (pk.toLowerCase() !== tree.publicKey.toLowerCase()) {
    throw new Error(`this contract is not controlled by your seed's account #${a.accountIndex} (epoch ${ep})`);
  }
  await J.withJournal((j) => {
    const acc = j.accounts[a.id];
    acc.address = address;
    acc.trees[ep] ??= { I: E.hexlify(tree.I), publicKey: tree.publicKey, nextLeaf: 0 };
    acc.currentEpoch = Math.max(acc.currentEpoch, ep);
    const known = j.log.some((e) => e.accountId === a.id);
    if ((nonce > 0n || ep > 0) && !known) {
      acc.locked = 'the account has on-chain activity that this browser\'s journal does not know about. Import your latest journal (Manage tab).';
    }
  });
  log(`Attached QRAC.me account ${address}`);
  renderAccountSelect();
  await refresh();
}
$('btnAttach').onclick = () => guard('Attach', () => attach($('attachAddr').value.trim()));

async function refresh() {
  const a = currentAccount();
  if (!S.provider || !a) {
    $('acctInfo').innerHTML = '<dt>Account</dt><dd class="muted">none selected</dd>';
    return;
  }
  if (!a.address) {
    $('acctInfo').innerHTML = `<dt>Account</dt><dd>#${a.accountIndex} · key tree ready, not deployed yet</dd>`;
    return;
  }
  const c = accountContract(a.address);
  const [bal, epoch, nonce, verifier, pk] = await Promise.all([
    S.provider.getBalance(a.address), c.epoch(), c.nonce(), c.verifier(), c.publicKey(),
  ]);
  const ep = Number(epoch);
  // adopt a rotation that landed on-chain
  if (ep > a.currentEpoch && a.trees[ep] && a.trees[ep].publicKey.toLowerCase() === pk.toLowerCase()) {
    await J.withJournal((j) => { j.accounts[a.id].currentEpoch = ep; });
    a.currentEpoch = ep;
  }
  const t = a.trees[a.currentEpoch];
  const left = Math.max(0, CAPACITY - J.RENEWAL_RESERVE - (t?.nextLeaf || 0));
  const pkOk = t && t.publicKey.toLowerCase() === pk.toLowerCase();
  $('acctInfo').innerHTML = `
    <dt>Account address</dt><dd>${addrLink(a.address)}</dd>
    <dt>Balance</dt><dd>${E.formatEther(bal)} ETH</dd>
    <dt>Key epoch (on-chain)</dt><dd>${ep}${ep !== a.currentEpoch ? ' <span class="pill bad">differs from local journal</span>' : ''}</dd>
    <dt>Action nonce</dt><dd>${nonce}</dd>
    <dt>One-time keys left</dt><dd>${left} for actions + ${J.RENEWAL_RESERVE} reserved for rotation (next key #${t?.nextLeaf ?? '?'})</dd>
    <dt>Public key matches seed</dt><dd>${pkOk ? '<span class="pill ok">yes</span>' : '<span class="pill bad">NO</span>'}</dd>
    <dt>Signing</dt><dd>${a.locked ? `<span class="pill bad">locked</span> ${esc(a.locked)}` : '<span class="pill ok">available</span>'}</dd>
    <dt>Verifier</dt><dd>${addrLink(verifier)}</dd>`;
  // step 2 showed this line before the account existed; keep it current once it is on chain
  $('predictedAddr').innerHTML = `${addrLink(a.address)} <span class="pill ok">on chain</span>
    <span class="small muted">· balance ${E.formatEther(bal)} ETH</span>`;
  await renderTokens(a);
}
$('btnRefresh').onclick = () => guard('Refresh', refresh);
async function fundCurrent(amount) {
  const a = requireAttached();
  const tx = await S.signer.sendTransaction({ to: a.address, value: E.parseEther(amount || '0') });
  log(`Funding tx ${tx.hash}`);
  await tx.wait();
  await refresh();
  return tx.hash;
}
$('btnFund').onclick = () => guard('Funding', () => fundCurrent($('fundAmount').value.trim() || '0'));

async function renderTokens(a) {
  const list = S.settings.tokens?.[a.id] || [];
  if (!list.length) { $('tokenTable').innerHTML = ''; return; }
  const rows = await Promise.all(list.map(async (t) => {
    const c = new E.Contract(t, ERC20_ABI, S.provider);
    const [sym, dec, bal] = await Promise.all([c.symbol().catch(() => '?'), c.decimals().catch(() => 18n), c.balanceOf(a.address).catch(() => 0n)]);
    return `<tr><td>${esc(sym)}</td><td>${addrLink(t)}</td><td>${E.formatUnits(bal, dec)}</td></tr>`;
  }));
  $('tokenTable').innerHTML = `<tr><th>Token</th><th>Address</th><th>Balance</th></tr>${rows.join('')}`;
}
$('btnAddToken').onclick = () => guard('Track token', async () => {
  const a = requireAttached();
  const t = E.getAddress($('tokenAddr').value.trim());
  S.settings.tokens = { ...(S.settings.tokens || {}) };
  S.settings.tokens[a.id] = [...new Set([...(S.settings.tokens[a.id] || []), t])];
  J.saveSettings(S.settings);
  $('tokenAddr').value = '';
  await renderTokens(a);
});

// ---------------------------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------------------------

function syncCallFields() {
  const t = $('callType').value;
  document.querySelectorAll('[data-for]').forEach((el) => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(t)));
}
$('callType').onchange = syncCallFields;
syncCallFields();
$('submitPolicy').onchange = () => { $('customSubmitter').disabled = $('submitPolicy').value !== 'custom'; };

async function tokenDecimals(token) {
  try { return Number(await new E.Contract(token, ERC20_ABI, S.provider).decimals()); } catch { return 18; }
}

$('btnAddCall').onclick = () => guard('Add call', async () => {
  requireConnected();
  const t = $('callType').value;
  let call;
  if (t === 'eth') {
    const to = E.getAddress($('cTo').value.trim());
    const v = E.parseEther($('cAmount').value.trim() || '0');
    call = { target: to, value: v, data: '0x', checkReturn: false, label: `Send ${E.formatEther(v)} ETH to ${to}` };
  } else if (t === 'erc20transfer' || t === 'erc20approve') {
    const token = E.getAddress($('cToken').value.trim());
    const who = E.getAddress((t === 'erc20transfer' ? $('cTo') : $('cSpender')).value.trim());
    const dec = await tokenDecimals(token);
    const amt = E.parseUnits($('cAmount').value.trim() || '0', dec);
    const fn = t === 'erc20transfer' ? 'transfer' : 'approve';
    call = {
      target: token, value: 0n, data: erc20.encodeFunctionData(fn, [who, amt]), checkReturn: true,
      label: `${fn === 'transfer' ? 'Transfer' : amt === 0n ? 'Revoke approval of' : 'Approve'} ${E.formatUnits(amt, dec)} of token ${token} ${fn === 'transfer' ? 'to' : 'for spender'} ${who}`,
    };
  } else {
    const target = E.getAddress($('cTarget').value.trim());
    const data = $('cData').value.trim() || '0x';
    if (!E.isHexString(data) || data.length % 2) throw new Error('calldata must be 0x-prefixed hex');
    const v = E.parseEther($('cValue').value.trim() || '0');
    call = { target, value: v, data, checkReturn: $('cCheck').checked, label: `Raw call to ${target}` };
  }
  S.batch.push(call);
  renderBatch();
});

function describeCall(c) {
  let decoded = '';
  try {
    const d = erc20.parseTransaction({ data: c.data });
    if (d) decoded = `${d.name}(${d.args.map(String).join(', ')})`;
  } catch { /* unknown calldata stays raw */ }
  return `<div><b>${esc(c.label)}</b>
    <div class="small mono">target ${esc(c.target)} · value ${E.formatEther(c.value)} ETH · data ${esc(c.data.length > 74 ? c.data.slice(0, 74) + '…' : c.data)}${decoded ? ` · decoded ${esc(decoded)}` : ' · not decoded (raw)'} · return check ${c.checkReturn ? 'ON' : 'off'}</div></div>`;
}

function renderBatch() {
  if (!S.batch.length) { $('batchList').innerHTML = '<p class="muted small">No calls yet.</p>'; return; }
  $('batchList').innerHTML = S.batch.map((c, i) => `<div class="call">${describeCall(c)}
    <div class="row"><button class="secondary" data-up="${i}">↑</button><button class="secondary" data-del="${i}">✕</button></div></div>`).join('');
}
$('batchList').onclick = (e) => {
  const up = e.target.dataset.up, del = e.target.dataset.del;
  if (up !== undefined && +up > 0) [S.batch[+up - 1], S.batch[+up]] = [S.batch[+up], S.batch[+up - 1]];
  if (del !== undefined) S.batch.splice(+del, 1);
  renderBatch();
};

async function buildHeader(kind) {
  const a = requireAttached();
  if (a.locked) throw new Error('signing is locked: ' + a.locked);
  const c = accountContract(a.address);
  const [epoch, nonce] = await Promise.all([c.epoch(), c.nonce()]);
  if (Number(epoch) !== a.currentEpoch) throw new Error(`on-chain epoch ${epoch} differs from the local journal (${a.currentEpoch}); import your latest journal`);
  const policy = $('submitPolicy').value;
  let allowedSubmitter = E.ZeroAddress;
  if (policy === 'connected') allowedSubmitter = S.submitter;
  if (policy === 'custom') allowedSubmitter = E.getAddress($('customSubmitter').value.trim());
  const minutes = Number($('validMinutes').value || 0);
  const validUntil = minutes > 0 ? (await chainNow()) + minutes * 60 : 0;
  return { a, c, header: { epoch: Number(epoch), nonce: nonce.toString(), kind, allowedSubmitter, validAfter: 0, validUntil } };
}

/** Prepare an action for review: encoding cross-checked against the live contract, calls simulated. */
async function prepare(kind, payload, summary, calls = []) {
  const { a, c, header } = await buildHeader(kind);
  const candidate = a.trees[a.currentEpoch].nextLeaf;
  const local = enc.authorizationMessage(S.chainId, a.address, header, candidate, payload);
  const remote = await c.authorizationMessage(enc.headerTuple(header), candidate, payload);
  if (local.toLowerCase() !== remote.toLowerCase()) throw new Error('local encoding differs from the contract: refusing to sign');
  const sims = [];
  for (const call of calls) {
    try {
      await S.provider.call({ from: a.address, to: call.target, value: call.value, data: call.data });
      sims.push('<span class="pill ok">simulated OK</span>');
    } catch (e) {
      sims.push(`<span class="pill warn">simulation reverted: ${esc(explain(e))}</span>`);
    }
  }
  S.pending = { kind, header, payload, summary, accountId: a.id, account: a.address };
  $('reviewBody').innerHTML = `
    <dl class="kv">
      <dt>Chain / account</dt><dd>${S.chainId} · ${addrLink(a.address)}</dd>
      <dt>Action</dt><dd><b>${enc.KIND_NAME[kind]}</b>: ${esc(summary)}</dd>
      <dt>Key epoch / nonce</dt><dd>${header.epoch} / ${header.nonce}</dd>
      <dt>Allowed submitter</dt><dd>${header.allowedSubmitter === E.ZeroAddress ? 'anyone (open)' : `<code>${header.allowedSubmitter}</code> only`}</dd>
      <dt>Valid until</dt><dd>${header.validUntil ? new Date(header.validUntil * 1000).toLocaleString() : 'no expiry'}</dd>
      <dt>One-time key</dt><dd>#${candidate} of ${CAPACITY} (reserved permanently when you sign)</dd>
      <dt>Signed bytes</dt><dd>${E.getBytes(local).length} bytes · <span class="pill ok">identical to the contract's authorizationMessage()</span></dd>
    </dl>
    ${calls.length ? `<h3>Calls, in order (all-or-nothing)</h3>${calls.map((cl, i) => `<div class="call">${describeCall(cl)}<div>${sims[i]}</div></div>`).join('')}
    <p class="small muted">Simulation runs each call separately from the account's address. A successful call means only that it did not revert.</p>` : ''}`;
  $('reviewPanel').classList.remove('hidden');
  $('signedPanel').classList.add('hidden');
  showTab('compose');
  $('reviewPanel').scrollIntoView({ behavior: 'smooth' });
}

$('btnReview').onclick = () => guard('Review', async () => {
  if (!S.batch.length) throw new Error('add at least one call');
  const payload = enc.executePayload(S.batch);
  await prepare(enc.KIND.EXECUTE, payload, S.batch.map((c) => c.label).join('; '), S.batch);
});
$('btnCancelReview').onclick = () => { $('reviewPanel').classList.add('hidden'); S.pending = null; };

// ---------------------------------------------------------------------------------------------
// sign & submit
// ---------------------------------------------------------------------------------------------

async function signPending() {
  const p = S.pending;
  if (!p) throw new Error('nothing to sign');
  const a = J.loadJournal().accounts[p.accountId];
  const epoch = p.header.epoch;
  // 1) reserve and persist the leaf BEFORE signing
  const entry = await J.reserveLeaf(a.id, epoch, p.kind, CAPACITY, {
    chainId: S.chainId, account: p.account, nonce: p.header.nonce, header: jsonable(p.header),
    payload: p.payload, summary: p.summary,
  });
  try {
    const message = enc.authorizationMessage(S.chainId, p.account, p.header, entry.leaf, p.payload);
    // 2) on-chain guard: never sign with a leaf the contract already saw
    if (await accountContract(p.account).isLeafUsed(epoch, entry.leaf)) {
      await J.updateEntry(entry.id, { status: 'burned', note: 'leaf already used on-chain (journal was behind)' });
      throw new Error(`one-time key #${entry.leaf} was already used on-chain: your journal is out of date. Import the latest journal.`);
    }
    // 3) sign and self-verify
    const tree = await getTree(S.chainId, a.accountIndex, epoch);
    const t0 = performance.now();
    const sig = lms.sign({ lmsType: LMS_TYPE, otsType: OTS_TYPE, I: tree.I, seed: tree.seed, T: tree.T }, entry.leaf, E.getBytes(message));
    if (!lms.verify(E.getBytes(tree.publicKey), E.getBytes(message), sig)) throw new Error('self-verification failed');
    const signed = await J.updateEntry(entry.id, { status: 'signed', message, signature: E.hexlify(sig) });
    log(`Signed ${enc.KIND_NAME[p.kind]} nonce ${p.header.nonce} with one-time key #${entry.leaf} (${(performance.now() - t0).toFixed(0)} ms).`);
    if (S.settings.autoDownload) J.downloadJournal();
    return signed;
  } catch (e) {
    const cur = J.loadJournal().log.find((x) => x.id === entry.id);
    if (cur && cur.status === 'reserved') await J.updateEntry(entry.id, { status: 'aborted', note: explain(e) });
    throw e;
  }
}

function showSigned(entry) {
  S.signed = entry;
  $('reviewPanel').classList.add('hidden');
  $('signedPanel').classList.remove('hidden');
  $('signedBody').innerHTML = `
    <dl class="kv">
      <dt>Action</dt><dd>${enc.KIND_NAME[entry.kind]}: ${esc(entry.summary)}</dd>
      <dt>Nonce / key</dt><dd>${entry.nonce} / one-time key #${entry.leaf} (epoch ${entry.epoch})</dd>
      <dt>Signature</dt><dd>${E.getBytes(entry.signature).length} bytes · <code>${entry.signature.slice(0, 42)}…</code></dd>
      <dt>Status</dt><dd id="signedStatus">${entry.status}</dd>
    </dl>
    <p class="small muted">If submission fails, this exact signed authorization can be retried while its nonce and
      validity window allow it. A changed action needs a new signature with a new one-time key.</p>`;
  showTab('compose');
}

$('btnSign').onclick = () => guard('Signing', async () => {
  const entry = await signPending();
  S.pending = null;
  S.batch = [];
  renderBatch();
  showSigned(entry);
  await refresh();
});

async function submitAuthorization({ account, header, payload, signature }, entryId) {
  requireConnected();
  const c = accountContract(account, S.signer);
  const args = [enc.headerTuple(header), payload, signature];
  await c.submit.staticCall(...args); // fail early with a decoded reason, without spending gas
  const tx = await c.submit(...args);
  log(`Submitted by ${S.submitter}: tx ${tx.hash}`);
  if (entryId) await J.updateEntry(entryId, { status: 'submitted', txHash: tx.hash, submitter: S.submitter });
  try {
    const r = await tx.wait();
    log(`Confirmed in block ${r.blockNumber}, gas used ${r.gasUsed}.`);
    if (entryId) {
      const e = await J.updateEntry(entryId, { status: 'confirmed', gasUsed: r.gasUsed.toString(), block: r.blockNumber });
      if (e.kind === enc.KIND.ROTATE) {
        await J.withJournal((j) => { j.accounts[e.accountId].currentEpoch = e.epoch + 1; });
        log(`Rotation confirmed: now using key epoch ${e.epoch + 1}.`);
      }
    }
  } catch (e) {
    // A mined revert carries no reason; re-simulate now to explain it (e.g. another action used the nonce first).
    let why = explain(e);
    try { await c.submit.staticCall(...args); } catch (e2) { why = `reverted on-chain; re-simulating now gives ${explain(e2)}`; }
    if (entryId) await J.updateEntry(entryId, { status: 'reverted', note: why });
    await refresh();
    throw new Error(why);
  }
  await refresh();
}

$('btnSubmit').onclick = () => guard('Submit', async () => {
  const e = S.signed;
  if (!e) throw new Error('nothing signed');
  await submitAuthorization(e, e.id);
  $('signedStatus').textContent = J.loadJournal().log.find((x) => x.id === e.id)?.status;
});

$('btnExportAuth').onclick = () => {
  const e = S.signed;
  if (!e) return;
  const out = { qrac: 'authorization-v1', chainId: e.chainId, account: e.account, header: e.header, payload: e.payload, signature: e.signature, summary: e.summary };
  J.downloadBlob(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), `qrac-authorization-nonce${e.nonce}-key${e.leaf}.json`);
  J.updateEntry(e.id, { exported: true });
  log('Authorization exported. Anyone allowed by its submitter policy can deliver it unchanged.');
};

$('btnSubmitImported').onclick = () => guard('Submit pasted authorization', async () => {
  const data = JSON.parse($('authImport').value);
  if (data.qrac !== 'authorization-v1') throw new Error('not a QRAC.me authorization');
  if (String(data.chainId) !== S.chainId) throw new Error(`authorization is for chain ${data.chainId}, connected to ${S.chainId}`);
  const own = J.loadJournal().log.find((x) => x.account === data.account && x.signature === data.signature);
  await submitAuthorization(data, own?.id);
});

// ---------------------------------------------------------------------------------------------
// manage
// ---------------------------------------------------------------------------------------------

$('btnCancelNonce').onclick = () => guard('Cancel', async () => {
  await prepare(enc.KIND.CANCEL, '0x', 'cancel whatever was signed for this nonce');
});

$('btnRotate').onclick = () => guard('Rotation', async () => {
  const a = requireAttached();
  const next = a.currentEpoch + 1;
  const tree = await getTree(S.chainId, a.accountIndex, next, $('rotProgress'));
  await J.withJournal((j) => {
    j.accounts[a.id].trees[next] ??= { I: E.hexlify(tree.I), publicKey: tree.publicKey, nextLeaf: 0 };
  });
  await prepare(enc.KIND.ROTATE, enc.rotatePayload(tree.publicKey, next), `rotate to key epoch ${next} (new public key ${tree.publicKey.slice(0, 18)}…)`);
});

$('chkAutoDownload').checked = !!S.settings.autoDownload;
$('chkAutoDownload').onchange = (e) => { S.settings.autoDownload = e.target.checked; J.saveSettings(S.settings); };
$('btnDownloadJournal').onclick = () => J.downloadJournal();
$('fileJournal').onchange = (ev) => guard('Import journal', async () => {
  const f = ev.target.files[0];
  if (!f) return;
  await J.importJournal(JSON.parse(await f.text()));
  ev.target.value = '';
  log('Journal imported and merged (key counters only move forward).');
  renderAccountSelect();
  await refresh();
});
$('btnWipe').onclick = () => {
  if (!confirm('Erase the 24 words, the journal and all cached data from this browser?')) return;
  if (!confirm('Really? Without a backup of your words and journal you lose control of your QRAC.me accounts.')) return;
  J.wipeAll();
  location.reload();
};

// ---------------------------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------------------------

async function renderActivity() {
  const a = currentAccount();
  const list = J.loadJournal().log.filter((e) => !a || e.accountId === a.id).slice().reverse();
  let nonce = null;
  if (a?.address && S.provider) nonce = await accountContract(a.address).nonce().catch(() => null);
  $('activityTable').innerHTML = `<tr><th>When</th><th>Key</th><th>Nonce</th><th>Action</th><th>Status</th><th>Tx</th></tr>` +
    list.map((e) => {
      let st = e.status;
      if (st === 'signed' && nonce !== null && BigInt(e.nonce) < nonce) st = 'superseded (nonce used by another action)';
      const cls = { confirmed: 'ok', reverted: 'bad', aborted: 'bad', burned: 'bad' }[e.status] || 'warn';
      return `<tr><td class="small">${new Date(e.createdAt).toLocaleString()}</td><td>#${e.leaf} (ep ${e.epoch})</td>
        <td>${e.nonce}</td><td>${enc.KIND_NAME[e.kind] || e.kind}: ${esc(e.summary || '')}</td>
        <td><span class="pill ${cls}">${esc(st)}</span>${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}</td>
        <td>${e.txHash ? txLink(e.txHash) : ''}</td></tr>`;
    }).join('');
}

// ---------------------------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------------------------

(async () => {
  const [w, v, acc, known] = await Promise.all([
    loadWordlist(),
    fetch('artifacts/LMSVerifier.json').then((r) => r.json()),
    fetch('artifacts/QRACAccount.json').then((r) => r.json()),
    fetch('deployments.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
  ]);
  S.known = known;
  S.artFactory = await fetch('artifacts/QRACFactory.json').then((r) => r.json());
  // drop a verifier saved under an unknown chain by the earlier connect bug
  if (S.settings.verifiers?.null) { delete S.settings.verifiers.null; J.saveSettings(S.settings); }
  S.words = w;
  S.art = { LMSVerifier: v, QRACAccount: acc, QRACFactory: S.artFactory };
  // account + factory errors decode in one place
  S.accountIface = new E.Interface([...acc.abi, ...S.artFactory.abi.filter((x) => x.type === 'error')]);
  const m = J.loadMnemonic();
  if (m) await loadSeed(m);
  if (location.port === '8545' && !window.ethereum) {
    $('netMode').value = 'local';
    $('localSignerBox').classList.remove('hidden');
  }
  window.QRAC = { S, J }; // for debugging in the console
  window.QRACAPI = {
    state: async () => {
      const a = currentAccount();
      const j = J.loadJournal();
      const accounts = S.chainId ? Object.values(j.accounts).filter((x) => x.chainId === S.chainId) : [];
      let balance = null;
      if (S.provider && a?.address) balance = await S.provider.getBalance(a.address).catch(() => null);
      const t = a?.trees?.[a.currentEpoch];
      return {
        hasSeed: !!S.bip39Seed, connected: !!(S.provider && S.chainId), chainId: S.chainId, submitter: S.submitter,
        hasWallet: !!window.ethereum, factory: factoryAddress(), account: a, accounts, balance,
        keysLeft: t ? Math.max(0, CAPACITY - J.RENEWAL_RESERVE - t.nextLeaf) : null,
        log: j.log.filter((e) => a && e.accountId === a.id).slice().reverse(),
      };
    },
    newSeed, importSeedFile, downloadSeedFile,
    connectWallet: async () => {
      $('netMode').value = window.ethereum ? 'injected' : (location.port === '8545' ? 'local' : 'injected');
      $('netMode').dispatchEvent(new Event('change'));
      await connect();
    },
    nextIndex: () => {
      const used = Object.values(J.loadJournal().accounts).filter((x) => x.chainId === S.chainId).map((x) => x.accountIndex);
      return used.length ? Math.max(...used) + 1 : 0;
    },
    selectAccount: async (id) => { S.current = id; renderAccountSelect(); await refresh(); },
    genTree, mintCurrent, fundCurrent, refresh, explain,
    /** Send ETH from the current account: review (encoding checked against the contract), sign, submit. */
    sendEth: async (to, amountEth, onStep = () => {}) => {
      const target = E.getAddress(to);
      const value = E.parseEther(String(amountEth));
      const call = { target, value, data: '0x', checkReturn: false, label: `Send ${E.formatEther(value)} ETH to ${target}` };
      onStep('review');
      await prepare(enc.KIND.EXECUTE, enc.executePayload([call]), call.label, [call]);
      onStep('sign');
      const entry = await signPending();
      S.pending = null;
      onStep('submit', entry);
      await submitAuthorization(entry, entry.id);
      const done = J.loadJournal().log.find((x) => x.id === entry.id);
      onStep('done', done);
      return done;
    },
    explorerTx: (h) => (EXPLORERS[S.chainId] ? `${EXPLORERS[S.chainId]}/tx/${h}` : null),
    explorerAddress: (a) => (EXPLORERS[S.chainId] ? `${EXPLORERS[S.chainId]}/address/${a}` : null),
  };
  window.dispatchEvent(new Event('qrac:ready'));
  log('Ready.');
})().catch((e) => log('Startup failed: ' + explain(e)));
