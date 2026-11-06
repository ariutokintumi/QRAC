// QRAC.me on the EIP-8141 frame-transaction devnet (Phase 3). Separate page; the Sepolia app (app.js) is untouched.
// Shares the seed, key derivation, LMS and the signer journal with it.
import * as E from './eth.js';
import { mnemonicToSeed } from './bip39.js';
import { deriveTree } from './derive.js';
import * as lms from './lms.js';
import * as enc from './encoding.js';
import * as J from './journal.js';
import * as F from './frametx.js';

const $ = (id) => document.getElementById(id);
const CHAIN = '1337';
const CAPACITY = 1024;
const LMS_TYPE = lms.LMS_SHA256_M32_H10;
const OTS_TYPE = lms.LMOTS_SHA256_N32_W4;
const MAX_FEE = 2_000_000_000n;
const STAKE_WEI = 12_000_000_000_000_000n; // 0.012 ETH (devnet minStake 0.01)
const UNSTAKE_DELAY = 86400;
const NONCE_MANAGER = '0x0000000000000000000000000000000000008250';
const BURNER_KEY = 'qrac.v1.devnet.burnerKey';
const FRAME_DOMAIN = E.keccak256(E.toUtf8Bytes('QRAC.FrameTx.v1'));
const VERIFY_SELECTOR = E.id('validateFrameTx()').slice(0, 10);

const S = { D: null, provider: null, burner: null, seed64: null, art: {}, trees: new Map(), tx: null, entryId: null };

// ------------------------------------------------------------------------------------------- helpers

function log(msg) {
  $('log').textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + $('log').textContent;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function short(a) {
  return a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '';
}
function txLink(h) {
  return `<a href="${S.D.explorer}${h}" target="_blank"><code>${short(h)}</code></a>`;
}
async function rpc(url, method, params = []) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message || JSON.stringify(j.error)), { rpc: j.error });
  return j.result;
}
function explain(e) {
  const data = e?.rpc?.data || e?.data || e?.info?.error?.data;
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    try { const pe = S.iface.parseError(data); if (pe) return `${pe.name}(${pe.args.map(String).join(', ')})`; } catch { /* raw */ }
  }
  const m = e?.rpc?.message || e?.shortMessage || e?.message || String(e);
  const sel = m.match(/0x[0-9a-fA-F]{8,}/);
  if (sel) { try { const pe = S.iface.parseError(sel[0]); if (pe) return `${m} → ${pe.name}(${pe.args.map(String).join(', ')})`; } catch { /* raw */ } }
  return m;
}
async function guard(label, fn) {
  try { return await fn(); } catch (e) { console.error(e); log(`${label} failed: ${explain(e)}`); alert(`${label} failed:\n${explain(e)}`); }
}
/**
 * Setup-key transactions (mint, fund, stake relay): signed locally, sent raw, receipt polled here.
 * ethers' own send path mis-parses this devnet's pending-transaction responses and can report a failure for a
 * transaction that WAS broadcast (observed: a funding reported as failed was mined), which invites double sends.
 */
async function burnerSend({ to, data = '0x', value = 0n, gasLimit }) {
  if (!S.burner) throw new Error('create and fund the devnet setup key first');
  const from = S.burner.address;
  const req = { from, to, data, value: E.toQuantity(value) };
  const gas = gasLimit ?? (BigInt(await rpc(S.D.executionRpc, 'eth_estimateGas', [req])) * 125n) / 100n + 50000n;
  const nonce = Number(await rpc(S.D.executionRpc, 'eth_getTransactionCount', [from, 'pending']));
  const raw = await S.burner.signTransaction({ type: 2, chainId: Number(CHAIN), nonce, to, data, value,
    gasLimit: gas, maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: 1_000_000_000n });
  const hash = await rpc(S.D.executionRpc, 'eth_sendRawTransaction', [raw]);
  log(`Setup-key tx sent: ${hash}`);
  for (let i = 0; i < 60; i++) {
    const r = await rpc(S.D.executionRpc, 'eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r) {
      if (r.status !== '0x1') throw new Error(`setup-key transaction ${hash} reverted`);
      return { hash, gasUsed: BigInt(r.gasUsed) };
    }
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  throw new Error(`setup-key transaction ${hash} not mined yet: check the balance before retrying`);
}

/** The RPC can answer a read a moment before it reflects the block that holds our receipt: wait until it does. */
async function waitFor(check, tries = 12) {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return true;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  return false;
}

const accountContract = (addr, runner) => new E.Contract(addr, S.art.account.abi, runner || S.provider);
const factory = (runner) => new E.Contract(S.D.frameFactory, S.art.factory.abi, runner || S.provider);
const currentId = () => J.accountId(CHAIN, Number($('fIndex').value || 0));
const currentAccount = () => J.loadJournal().accounts[currentId()] || null;

async function nonceKeySeq(sender, key) {
  const slot = E.keccak256(E.concat([E.zeroPadValue(sender, 32), E.toBeHex(key, 32)]));
  return BigInt(await rpc(S.D.executionRpc, 'eth_getStorageAt', [NONCE_MANAGER, slot, 'latest']));
}

// ------------------------------------------------------------------------------------------- seed + setup key

async function renderSeed() {
  const m = J.loadMnemonic();
  if (!m) {
    $('seedInfo').innerHTML = '<dt>24-word seed</dt><dd><span class="pill bad">none</span> create or import it in the <a href="index.html">Sepolia page → Setup</a> (same seed for both)</dd>';
    return;
  }
  S.seed64 = await mnemonicToSeed(m);
  $('seedInfo').innerHTML = `<dt>24-word seed</dt><dd><span class="pill ok">loaded</span> fingerprint <code>${E.keccak256(S.seed64).slice(0, 18)}</code> (shared with the Sepolia page; trees on chain 1337 are independent)</dd>`;
}

async function renderBurner() {
  const k = localStorage.getItem(BURNER_KEY);
  S.burner = k ? new E.Wallet(k, S.provider) : null;
  if (!S.burner) { $('burnerInfo').innerHTML = '<dt>Setup key</dt><dd class="muted">none yet</dd>'; return; }
  const bal = await S.provider.getBalance(S.burner.address);
  $('burnerInfo').innerHTML = `<dt>Setup key (devnet only)</dt><dd><code>${S.burner.address}</code> · ${E.formatEther(bal)} ETH</dd>`;
}

$('btnBurner').onclick = () => guard('Create setup key', async () => {
  if (localStorage.getItem(BURNER_KEY) && !confirm('Replace the devnet setup key?')) return;
  localStorage.setItem(BURNER_KEY, E.Wallet.createRandom().privateKey);
  await renderBurner();
  log('Devnet setup key created (throwaway, stored in this browser).');
});
$('btnFaucet').onclick = () => guard('Faucet', async () => {
  if (!S.burner) throw new Error('create the devnet setup key first');
  const before = await S.provider.getBalance(S.burner.address);
  const res = await rpc(S.D.altMempoolRpc, 'skandha_explorer_faucet', [S.burner.address]);
  log(`Faucet: ${JSON.stringify(res)}`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if ((await S.provider.getBalance(S.burner.address)) > before) break;
  }
  await renderBurner();
});

// ------------------------------------------------------------------------------------------- key tree + account

function buildInWorker(I, seed, bar) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./lms-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => {
      if (ev.data.progress !== undefined) { if (bar) bar.style.width = `${(ev.data.progress * 100).toFixed(0)}%`; return; }
      w.terminate();
      ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data);
    };
    w.postMessage({ id: 1, lmsType: LMS_TYPE, otsType: OTS_TYPE, I, seed });
  });
}

async function getTree(idx, epoch) {
  if (!S.seed64) throw new Error('no seed: create or import it on the Sepolia page first');
  const key = `${CHAIN}.${idx}.${epoch}`;
  if (S.trees.has(key)) return S.trees.get(key);
  const { seed, I } = await deriveTree(S.seed64, BigInt(CHAIN), idx, epoch);
  let T = J.cachedTree(CHAIN, idx, epoch);
  if (!T) {
    $('fProgress').classList.remove('hidden');
    const r = await buildInWorker(I, seed, $('fProgress').querySelector('div'));
    T = r.T;
    J.cacheTree(CHAIN, idx, epoch, T);
    $('fProgress').classList.add('hidden');
    log(`Key tree (chain 1337, account #${idx}, epoch ${epoch}) built in ${(r.ms / 1000).toFixed(2)} s.`);
  }
  const tree = { seed, I, T, publicKey: E.hexlify(lms.publicKey(LMS_TYPE, OTS_TYPE, I, T)) };
  S.trees.set(key, tree);
  return tree;
}

$('btnFTree').onclick = () => guard('Key generation', async () => {
  const idx = Number($('fIndex').value || 0);
  const tree = await getTree(idx, 0);
  await J.withJournal((j) => {
    j.accounts[J.accountId(CHAIN, idx)] ??= {
      id: J.accountId(CHAIN, idx), chainId: CHAIN, accountIndex: idx, address: null, lmsType: LMS_TYPE, otsType: OTS_TYPE,
      currentEpoch: 0, trees: { 0: { I: E.hexlify(tree.I), publicKey: tree.publicKey, nextLeaf: 0 } }, locked: null, frame: true,
    };
  });
  await refresh();
});

async function refresh() {
  const a = currentAccount();
  if (!a) { $('fAcct').innerHTML = '<dt>Account</dt><dd class="muted">generate the key tree first</dd>'; renderActivity(); return; }
  const pk = a.trees[0].publicKey;
  const addr = await factory().predictAddress(pk);
  const minted = (await S.provider.getCode(addr)) !== '0x';
  if (minted && !a.address) await J.withJournal((j) => { j.accounts[a.id].address = addr; });
  const bal = await S.provider.getBalance(addr);
  let extra = '';
  if (minted) {
    const c = accountContract(addr);
    const [ep, nonce, chainPk] = await Promise.all([c.epoch(), c.nonce(), c.publicKey()]);
    const dep = await rpc(S.D.executionRpc, 'eth_call', [{ to: S.D.stakingRegistry,
      data: new E.Interface(['function getDepositInfo(address)']).encodeFunctionData('getDepositInfo', [addr]) }, 'latest']);
    const [amount, delay, withdrawTime] = E.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256', 'uint256'], E.dataSlice(dep, 0, 96));
    const staked = amount > 10n ** 16n && withdrawTime === 0n;
    extra = `<dt>Key epoch / submit() nonce</dt><dd>${ep} / ${nonce}</dd>
      <dt>Public key matches seed</dt><dd>${chainPk.toLowerCase() === pk.toLowerCase() ? '<span class="pill ok">yes</span>' : '<span class="pill bad">NO</span>'}</dd>
      <dt>Alt-mempool stake</dt><dd>${staked ? `<span class="pill ok">staked</span> ${E.formatEther(amount)} ETH, unstake delay ${delay}s` : '<span class="pill warn">not staked</span>'}</dd>`;
  }
  const t = J.loadJournal().accounts[a.id].trees[0];
  $('fAcct').innerHTML = `<dt>Account address</dt><dd><code>${addr}</code> ${minted ? '<span class="pill ok">minted</span>' : '<span class="pill warn">not minted yet</span>'}</dd>
    <dt>Balance</dt><dd>${E.formatEther(bal)} ETH</dd>${extra}
    <dt>Next one-time key</dt><dd>#${t.nextLeaf} of ${CAPACITY}</dd>`;
  renderActivity();
}
$('btnFRefresh').onclick = () => guard('Refresh', refresh);
$('fIndex').onchange = () => refresh().catch((e) => log(explain(e)));

$('btnFMint').onclick = () => guard('Mint', async () => {
  const a = currentAccount();
  if (!a) throw new Error('generate the key tree first');
  const r = await burnerSend({ to: S.D.frameFactory, data: factory().interface.encodeFunctionData('mint', [a.trees[0].publicKey]) });
  log(`Minted (gas ${r.gasUsed}): tx ${r.hash}`);
  const addr = await factory().predictAddress(a.trees[0].publicKey);
  await waitFor(async () => (await rpc(S.D.executionRpc, 'eth_getCode', [addr, 'latest'])) !== '0x');
  await refresh();
});
$('btnFFund').onclick = () => guard('Fund', async () => {
  const a = currentAccount();
  if (!a?.address) throw new Error('mint the account first');
  const before = BigInt(await rpc(S.D.executionRpc, 'eth_getBalance', [a.address, 'latest']));
  const r = await burnerSend({ to: a.address, value: E.parseEther($('fFund').value || '0'), gasLimit: 100000n });
  log(`Funded account: ${r.hash}`);
  await waitFor(async () => BigInt(await rpc(S.D.executionRpc, 'eth_getBalance', [a.address, 'latest'])) > before);
  await refresh();
});

// ------------------------------------------------------------------------------------------- one-time keys

/** Reserve a leaf (persisted before signing) and check on-chain that it was never used on either path. */
async function reserve(a, epoch, meta) {
  const entry = await J.reserveLeaf(a.id, epoch, 1, CAPACITY, { chainId: CHAIN, account: a.address, ...meta });
  const c = accountContract(a.address);
  const usedLegacy = await c.isLeafUsed(epoch, entry.leaf);
  const usedFrame = (await nonceKeySeq(a.address, F.frameNonceKey(epoch, entry.leaf))) !== 0n;
  if (usedLegacy || usedFrame) {
    await J.updateEntry(entry.id, { status: 'burned', note: 'already used on-chain (journal was behind)' });
    throw new Error(`one-time key #${entry.leaf} was already used on-chain: import your latest journal`);
  }
  return entry;
}

// ------------------------------------------------------------------------------------------- stake (Phase 1 path)

$('btnFStake').onclick = () => guard('Stake', async () => {
  const a = currentAccount();
  if (!a?.address) throw new Error('mint the account first');
  if (!S.burner) throw new Error('the setup key relays this transaction: create and fund it first');
  const c = accountContract(a.address);
  const [epoch, nonce] = (await Promise.all([c.epoch(), c.nonce()])).map(Number);
  const payload = enc.executePayload([{ target: S.D.stakingRegistry, value: STAKE_WEI,
    data: new E.Interface(['function addStake(uint32)']).encodeFunctionData('addStake', [UNSTAKE_DELAY]), checkReturn: false }]);
  const header = { epoch, nonce: String(nonce), kind: enc.KIND.EXECUTE, allowedSubmitter: E.ZeroAddress, validAfter: 0, validUntil: 0 };
  const entry = await reserve(a, epoch, { kind: 1, nonce: String(nonce), summary: 'stake 0.012 ETH in the alt-mempool registry (submit() path)' });
  const message = enc.authorizationMessage(CHAIN, a.address, header, entry.leaf, payload);
  if ((await c.authorizationMessage(enc.headerTuple(header), entry.leaf, payload)).toLowerCase() !== message.toLowerCase()) {
    throw new Error('encoding differs from the contract: refusing to sign');
  }
  const tree = await getTree(a.accountIndex, epoch);
  const sig = E.hexlify(lms.sign({ lmsType: LMS_TYPE, otsType: OTS_TYPE, I: tree.I, seed: tree.seed, T: tree.T }, entry.leaf, E.getBytes(message)));
  await J.updateEntry(entry.id, { status: 'signed', signature: sig });
  const r = await burnerSend({ to: a.address, data: c.interface.encodeFunctionData('submit', [enc.headerTuple(header), payload, sig]) });
  await J.updateEntry(entry.id, { status: 'confirmed', txHash: r.hash, gasUsed: r.gasUsed.toString() });
  log(`Staked through submit(): ${r.hash} (gas ${r.gasUsed})`);
  await refresh();
});

// ------------------------------------------------------------------------------------------- frame transactions

$('btnFSign').onclick = () => guard('Sign', async () => {
  const a = currentAccount();
  if (!a?.address) throw new Error('mint and fund the account first');
  const c = accountContract(a.address);
  const epoch = Number(await c.epoch());
  if (!a.trees[epoch]) throw new Error(`no local key tree for epoch ${epoch}`);
  const to = E.getAddress($('fTo').value.trim());
  const value = E.parseEther($('fAmount').value.trim() || '0');
  const entry = await reserve(a, epoch, { kind: 1, frame: true, nonce: 'n/a',
    summary: `frame tx: send ${E.formatEther(value)} ETH to ${to}` });
  const tx = {
    chainId: BigInt(CHAIN), sender: a.address, nonceKeys: [F.frameNonceKey(epoch, entry.leaf)], nonceSeq: 0n,
    frames: [
      { mode: F.MODE.VERIFY, flags: F.SCOPE.EXECUTION_AND_PAYMENT, target: a.address, execution: 320000n, state: 0n, value: 0n, data: VERIFY_SELECTOR },
      { mode: F.MODE.SENDER, flags: 0, target: to, execution: 60000n, state: 200000n, value, data: '0x' },
    ],
    signatures: [{ scheme: F.SCHEME.ARBITRARY, signer: '0x', msg: '0x', signature: '0x' }],
    maxPriorityFeePerGas: MAX_FEE, maxFeePerGas: MAX_FEE,
  };
  const h = F.sigHash(tx);
  const message = E.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [FRAME_DOMAIN, h]);
  if ((await c.frameMessage(h)).toLowerCase() !== message.toLowerCase()) throw new Error('frameMessage differs from the contract');
  const tree = await getTree(a.accountIndex, epoch);
  const t0 = performance.now();
  const sig = lms.sign({ lmsType: LMS_TYPE, otsType: OTS_TYPE, I: tree.I, seed: tree.seed, T: tree.T }, entry.leaf, E.getBytes(message));
  tx.signatures[0].signature = E.hexlify(sig);
  await J.updateEntry(entry.id, { status: 'signed', txHash: F.txHash(tx), sigHash: h, wire: F.wire(tx) });
  log(`Signed frame tx with one-time key #${entry.leaf} (${(performance.now() - t0).toFixed(0)} ms); nonce key ${tx.nonceKeys[0]}`);
  S.tx = tx;
  S.entryId = entry.id;

  let sim;
  try { sim = await rpc(S.D.executionRpc, 'ethrex_simulateFrameTransaction', [F.raw(tx), 'latest', { trace: false }]); } catch (e) { sim = { error: explain(e) }; }
  const fr = sim.frames || [];
  $('fSim').innerHTML = `<dl class="kv">
    <dt>Signatures in the transaction</dt><dd><b>1 post-quantum (LMS, ${sig.length} bytes)</b> · 0 ECDSA</dd>
    <dt>One-time key → nonce key</dt><dd>#${entry.leaf} (epoch ${epoch}) → ${tx.nonceKeys[0]}, sequence 0</dd>
    <dt>Simulation</dt><dd>${sim.error ? `<span class="pill bad">${esc(sim.error)}</span>` : `<span class="pill ${sim.executionStatus === 'success' ? 'ok' : 'bad'}">${esc(sim.executionStatus || sim.executionError)}</span>`}</dd>
    ${fr.length ? `<dt>VERIFY frame (PQ check)</dt><dd>${Number(fr[0].gasUsed).toLocaleString()} gas · ${fr[0].succeeded ? 'approved' : 'rejected'}</dd>
    <dt>SENDER frame (transfer)</dt><dd>${Number(fr[1].gasUsed).toLocaleString()} gas · ${fr[1].succeeded ? 'ok' : 'failed'}</dd>` : ''}
    <dt>Public mempool verdict</dt><dd>${sim.canonicalMempoolValid === false ? `<span class="pill warn">not allowed</span> ${esc(sim.canonicalMempoolViolation)}` : esc(String(sim.canonicalMempoolValid))}</dd>
    <dt>Gas paid by</dt><dd>${sim.payer ? `<code>${sim.payer}</code> (the account itself)` : 'n/a'}</dd></dl>`;
  $('fSubmitRow').classList.remove('hidden');
  $('fResult').innerHTML = '';
});

$('btnFCanon').onclick = () => guard('Public mempool', async () => {
  if (!S.tx) throw new Error('sign first');
  try {
    const h = await rpc(S.D.executionRpc, 'eth_sendRawTransaction', [F.raw(S.tx)]);
    $('fResult').innerHTML = `<p><span class="pill warn">accepted by the public mempool</span> ${esc(h)}</p>`;
  } catch (e) {
    $('fResult').innerHTML = `<p><span class="pill bad">Rejected by the public (canonical) mempool</span> ${esc(explain(e))}</p>
      <p class="small muted">The post-quantum check needs ~250k gas of validation; the public mempool allows 100k.
      The same signed transaction can still be submitted to the alternative mempool.</p>`;
    log(`Public mempool rejected the frame tx: ${explain(e)}`);
  }
});

$('btnFAlt').onclick = () => guard('Alternative mempool', async () => {
  if (!S.tx) throw new Error('sign first');
  let hash;
  try {
    hash = await rpc(S.D.altMempoolRpc, 'eth_sendFrameTransaction', [F.wire(S.tx)]);
  } catch (e) {
    await J.updateEntry(S.entryId, { status: 'rejected', note: explain(e) });
    throw e;
  }
  await J.updateEntry(S.entryId, { status: 'submitted', txHash: hash });
  $('fResult').innerHTML = `<p><span class="pill ok">Admitted by the alternative mempool</span> ${txLink(hash)} · waiting for a block…</p>`;
  let r = null;
  for (let i = 0; i < 40 && !r; i++) { await new Promise((ok) => setTimeout(ok, 3000)); r = await rpc(S.D.altMempoolRpc, 'eth_getTransactionReceipt', [hash]).catch(() => null); }
  let checks = [];
  try { const rep = await rpc(S.D.altMempoolRpc, 'skandha_explorer_getTransaction', [hash]); checks = rep?.admission?.checks || []; } catch { /* explorer API optional */ }
  const passed = checks.filter((c) => c.verdict === 'pass').length;
  await J.updateEntry(S.entryId, { status: r && r.status === '0x1' ? 'confirmed' : 'reverted', block: r ? Number(r.blockNumber) : null });
  $('fResult').innerHTML = `<dl class="kv">
    <dt>Alternative mempool</dt><dd><span class="pill ok">admitted</span> ${checks.length ? `${passed}/${checks.length} admission checks passed` : ''}</dd>
    <dt>On chain</dt><dd>${r ? `block ${Number(r.blockNumber)} · status ${r.status === '0x1' ? '<span class="pill ok">success</span>' : '<span class="pill bad">failed</span>'} · ${Number(r.gasUsed).toLocaleString()} gas` : 'not yet'}</dd>
    <dt>Explorer</dt><dd>${txLink(hash)}</dd></dl>`;
  log(`Frame tx ${hash} ${r ? `mined in block ${Number(r.blockNumber)}` : 'admitted'}`);
  S.tx = null;
  $('fSubmitRow').classList.add('hidden');
  await refresh();
});

function renderActivity() {
  const list = J.loadJournal().log.filter((e) => e.accountId?.startsWith(`${CHAIN}:`)).slice().reverse();
  $('fActivity').innerHTML = '<tr><th>When</th><th>Key</th><th>Action</th><th>Status</th><th>Tx</th></tr>' + list.map((e) =>
    `<tr><td class="small">${new Date(e.createdAt).toLocaleString()}</td><td>#${e.leaf} (ep ${e.epoch})</td>
     <td>${esc(e.summary || '')}</td><td><span class="pill ${e.status === 'confirmed' ? 'ok' : ['rejected', 'burned', 'reverted'].includes(e.status) ? 'bad' : 'warn'}">${esc(e.status)}</span>
     ${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}</td><td>${e.txHash ? txLink(e.txHash) : ''}</td></tr>`).join('');
}

// ------------------------------------------------------------------------------------------- boot

(async () => {
  const [known, acc, fac] = await Promise.all([
    fetch('deployments.json').then((r) => r.json()),
    fetch('artifacts/QRACFrameAccount.json').then((r) => r.json()),
    fetch('artifacts/QRACFrameFactory.json').then((r) => r.json()),
  ]);
  S.D = known[CHAIN];
  S.art = { account: acc, factory: fac };
  S.iface = new E.Interface([...acc.abi.filter((x) => x.type === 'error'), ...fac.abi.filter((x) => x.type === 'error')]);
  S.provider = new E.JsonRpcProvider(S.D.executionRpc, Number(CHAIN), { staticNetwork: true, batchMaxCount: 1 });
  const [id, block] = await Promise.all([rpc(S.D.executionRpc, 'eth_chainId'), rpc(S.D.executionRpc, 'eth_blockNumber')]);
  $('netPill').textContent = `devnet chain ${parseInt(id, 16)} · block ${parseInt(block, 16)}`;
  $('netPill').className = 'pill ok';
  await renderSeed();
  await renderBurner();
  await refresh();
  window.QRACF = { S, J, F };
  log('Ready (frame-transaction devnet).');
})().catch((e) => log('Startup failed: ' + explain(e)));
