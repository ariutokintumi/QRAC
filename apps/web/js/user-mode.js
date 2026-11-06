// QRAC.me User mode: a minimal, wallet-style UI over the same logic as Dev mode (window.QRACAPI on the Sepolia
// page, window.QRACFAPI on the frame-transaction page). Pure frontend: one site, a body class switches the views.
import * as E from './eth.js';

const PAGE = document.body.dataset.page; // 'sepolia' | 'frame'
const MODE_KEY = 'qrac.v1.uimode';
const DEFAULT_TO = '0x8943545177806ED17B9F23F0a21ee5948eCaa776';
let API = null;
let busy = false;
let panel = null; // 'send' | 'receive' | 'fund' | null

// ------------------------------------------------------------------------------------------- helpers

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
function eth(v, digits = 4) {
  if (v == null) return '0';
  const n = Number(E.formatEther(v));
  if (n === 0) return '0';
  if (n < 0.0001) return '<0.0001';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
const getMode = () => { try { return localStorage.getItem(MODE_KEY) || 'user'; } catch { return 'user'; } };
const view = () => document.getElementById('uaView');
const errorBox = (e) => `<div class="ua-error">${esc(API?.explain ? API.explain(e) : (e?.message || e))}</div>`;
const steps = (n) => `<div class="ua-steps">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;

function progress(items) {
  return `<ul class="ua-progress">${items.map((it) => `<li class="${it.s || ''}"><span class="dot">${it.s === 'ok' ? '✓' : it.s === 'bad' ? '✕' : ''}</span>
    <span>${it.t}${it.sub ? `<small>${it.sub}</small>` : ''}</span></li>`).join('')}</ul>`;
}

async function withBusy(btn, fn) {
  if (busy) return;
  busy = true;
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ua-spin"></span>'; }
  try { await fn(); } finally {
    busy = false;
    if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = label; }
  }
}

function copy(text, el) {
  navigator.clipboard?.writeText(text).then(() => {
    if (!el) return;
    const old = el.innerHTML;
    el.innerHTML = 'Copied ✓';
    setTimeout(() => { el.innerHTML = old; }, 1200);
  }).catch(() => {});
}

// ------------------------------------------------------------------------------------------- shell

function shell() {
  const app = document.createElement('div');
  app.id = 'userApp';
  app.className = 'user-only';
  app.innerHTML = `<div class="ua">
    <div class="ua-card">
      <div class="ua-top">
        <div class="ua-brand"><img src="assets/brand/logo-192.png" alt=""><span>QRAC<b>.me</b></span></div>
        <div class="ua-net">
          <a href="index.html" class="${PAGE === 'sepolia' ? 'on' : ''}">Today · Sepolia</a>
          <a href="frame.html" class="${PAGE === 'frame' ? 'on' : ''}">Future · EIP-8141</a>
        </div>
      </div>
      <div id="uaView"><p class="ua-empty">Loading…</p></div>
    </div>
    <p class="ua-foot">Post-quantum accounts for Ethereum · testnets only · <a data-go-dev>Advanced options (Dev mode)</a></p>
  </div>`;
  document.body.prepend(app);
  app.querySelector('[data-go-dev]').onclick = () => setMode('dev');

  const sw = document.createElement('div');
  sw.className = 'mode-switch';
  sw.innerHTML = `<span data-l="dev">Dev</span><label class="switch"><input type="checkbox" id="modeToggle"><span class="slider"></span></label><span data-l="user">User</span>`;
  document.body.appendChild(sw);
  sw.querySelector('#modeToggle').onchange = (e) => setMode(e.target.checked ? 'user' : 'dev');
}

function setMode(m) {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ }
  apply(m);
}

function apply(m) {
  document.body.classList.toggle('mode-user', m === 'user');
  document.body.classList.toggle('mode-dev', m !== 'user');
  const t = document.getElementById('modeToggle');
  if (t) t.checked = m === 'user';
  document.querySelectorAll('.mode-switch [data-l]').forEach((s) => s.classList.toggle('on', s.dataset.l === m));
  if (m === 'user') render();
}

// ------------------------------------------------------------------------------------------- shared step: key

function viewKey(note = '') {
  view().innerHTML = `${steps(1)}
    <img class="ua-hero" src="assets/brand/logo-192.png" alt="">
    <h1>Your quantum-safe key</h1>
    <p>24 words that only you hold, from 256 bits of fresh randomness. They become 1,024 hash-based one-time keys:
      nothing a quantum computer can break.</p>
    <button class="ua-btn" id="uaNewKey">Create my key</button>
    <label class="ua-link">I already have a key file<input type="file" id="uaKeyFile" accept=".json,.txt"></label>
    <p class="ua-note">A secret file downloads. Keep it safe: with it (and your journal) you can restore your account anywhere.</p>
    ${note}`;
  document.getElementById('uaNewKey').onclick = (ev) => withBusy(ev.currentTarget, async () => {
    try { await API.newSeed(); await render(); } catch (e) { viewKey(errorBox(e)); }
  });
  document.getElementById('uaKeyFile').onchange = (ev) => withBusy(null, async () => {
    const f = ev.target.files[0];
    if (!f) return;
    try { await API.importSeedFile(f); await render(); } catch (e) { viewKey(errorBox(e)); }
  });
}

// ------------------------------------------------------------------------------------------- Sepolia (today)

async function renderSepolia() {
  const st = await API.state();
  if (!st.hasSeed) return viewKey();
  if (!st.connected) {
    // reconnect silently if the wallet already authorized this site
    if (window.ethereum && !renderSepolia.tried) {
      renderSepolia.tried = true;
      try {
        const accts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accts && accts.length) { await API.connectWallet(); return renderSepolia(); }
      } catch { /* ask below */ }
    }
    return viewConnect(st);
  }
  if (st.chainId !== '11155111' && st.chainId !== '131277322940537') {
    view().innerHTML = `<h1>Switch to Sepolia</h1><p>Your wallet is on chain ${esc(st.chainId)}. QRAC.me "Today" runs on the Sepolia test network.</p>
      <button class="ua-btn" id="uaReconnect">I switched, reconnect</button>`;
    document.getElementById('uaReconnect').onclick = (ev) => withBusy(ev.currentTarget, async () => { await API.connectWallet(); await render(); });
    return;
  }
  const minted = st.accounts.filter((a) => a.address).sort((a, b) => b.accountIndex - a.accountIndex);
  if (!minted.length) return viewCreateSepolia(st);
  if (!st.account?.address || (!renderSepolia.picked && st.account.id !== minted[0].id)) {
    renderSepolia.picked = true;
    await API.selectAccount(minted[0].id);
    return renderSepolia();
  }
  return viewWalletSepolia(st, minted);
}

function viewConnect(st, note = '') {
  view().innerHTML = `${steps(2)}
    <h1>Connect a wallet to pay gas</h1>
    <p>Your wallet only pays the network fees and delivers your signed actions. It never controls your QRAC.me account:
      even if its key leaks, it can't move your funds.</p>
    <button class="ua-btn" id="uaConnect">Connect wallet</button>
    ${st.hasWallet ? '' : '<p class="ua-note">No browser wallet found. Install Brave Wallet or MetaMask and select Sepolia.</p>'}
    ${note}`;
  document.getElementById('uaConnect').onclick = (ev) => withBusy(ev.currentTarget, async () => {
    try { await API.connectWallet(); await render(); } catch (e) { viewConnect(st, errorBox(e)); }
  });
}

function viewCreateSepolia(st, note = '', prog = null) {
  view().innerHTML = `${steps(3)}
    <h1>Create your account</h1>
    <p>Your browser generates 1,024 one-time post-quantum keys, then your account is minted on Sepolia.
      It is a tiny contract whose only owner is your key.</p>
    ${prog ? progress(prog) : '<button class="ua-btn" id="uaCreate">Create my account</button><p class="ua-note">Your wallet pays the mint (about 740k gas).</p>'}
    ${note}`;
  const b = document.getElementById('uaCreate');
  if (!b) return;
  b.onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const items = [{ t: 'Generating 1,024 one-time keys', s: 'run' }, { t: 'Minting your account', sub: 'confirm in your wallet' }];
    viewCreateSepolia(st, '', items);
    try {
      await API.genTree(API.nextIndex());
      items[0].s = 'ok'; items[1].s = 'run'; viewCreateSepolia(st, '', items);
      await API.mintCurrent();
      items[1].s = 'ok'; viewCreateSepolia(st, '', items);
      panel = 'fund';
      await render();
    } catch (e) { viewCreateSepolia(st, errorBox(e)); }
  });
}

function activityHtml(log, explorerTx) {
  const rows = log.slice(0, 5).map((e) => {
    const cls = { confirmed: 'ok', reverted: 'bad', rejected: 'bad', aborted: 'bad', burned: 'bad' }[e.status] || 'warn';
    const what = (e.summary || '').replace(/ to (0x[0-9a-fA-F]{40})/, (m, a) => ` to ${short(a)}`);
    const link = e.txHash && explorerTx(e.txHash) ? ` · <a href="${explorerTx(e.txHash)}" target="_blank">view</a>` : '';
    return `<div class="row"><span class="what">${esc(what)}</span><span class="st ${cls}">${esc(e.status)}${link}</span></div>`;
  }).join('');
  return `<div class="ua-activity"><h3>Activity</h3>${rows || '<p class="ua-empty">No activity yet.</p>'}</div>`;
}

function walletHead(balance, address, badges, selectHtml = '') {
  return `${selectHtml}<div class="ua-balance">
      <div class="label">Balance</div>
      <div class="amount">${eth(balance)}<small>ETH</small></div>
      <span class="ua-addr" id="uaAddr" title="Copy address">${short(address)} ⧉</span>
    </div>
    <div class="ua-badges">${badges}</div>
    <div class="ua-actions">
      <button data-p="send" class="${panel === 'send' ? 'on' : ''}"><span class="ic">↗</span>Send</button>
      <button data-p="receive" class="${panel === 'receive' ? 'on' : ''}"><span class="ic">↙</span>Receive</button>
      <button data-p="fund" class="${panel === 'fund' ? 'on' : ''}"><span class="ic">＋</span>Add funds</button>
    </div>
    <div id="uaPanel"></div>`;
}

function bindWalletHead(address, onPanel) {
  document.getElementById('uaAddr').onclick = (ev) => copy(address, ev.currentTarget);
  view().querySelectorAll('.ua-actions button').forEach((b) => {
    b.onclick = () => { panel = panel === b.dataset.p ? null : b.dataset.p; render(); };
  });
  if (panel) onPanel(panel);
}

function viewWalletSepolia(st, minted) {
  const a = st.account;
  const select = minted.length > 1
    ? `<select class="ua-select" id="uaAcct">${minted.map((m) => `<option value="${m.id}" ${m.id === a.id ? 'selected' : ''}>Account #${m.accountIndex} · ${short(m.address)}</option>`).join('')}</select>`
    : '';
  const badges = `<span class="ua-badge">Post-quantum protected</span><span class="ua-badge v">${st.keysLeft ?? '?'} one-time keys left</span>
    ${a.locked ? '<span class="ua-badge warn">Signing locked: import your journal (Dev mode)</span>' : ''}`;
  view().innerHTML = walletHead(st.balance, a.address, badges, select) + activityHtml(st.log, API.explorerTx);
  const sel = document.getElementById('uaAcct');
  if (sel) sel.onchange = async () => { await API.selectAccount(sel.value); render(); };
  bindWalletHead(a.address, (p) => panelSepolia(p, st));
}

function panelSepolia(p, st, note = '') {
  const el = document.getElementById('uaPanel');
  const a = st.account;
  if (p === 'receive') {
    el.innerHTML = `<div class="ua-panel"><label>Your account address (Sepolia)</label><div class="ua-big-addr">${a.address}</div>
      <button class="ua-btn ghost" id="uaCopy">Copy address</button>
      <p class="ua-note">Send Sepolia ETH or tokens here. Only your post-quantum key can move them.</p></div>`;
    document.getElementById('uaCopy').onclick = (ev) => copy(a.address, ev.currentTarget);
  } else if (p === 'fund') {
    el.innerHTML = `<div class="ua-panel"><label>Amount from your wallet (ETH)</label><input id="uaFundAmt" value="0.02">
      <button class="ua-btn" id="uaFund">Add funds</button>${note}</div>`;
    document.getElementById('uaFund').onclick = (ev) => withBusy(ev.currentTarget, async () => {
      try { await API.fundCurrent(document.getElementById('uaFundAmt').value.trim()); panel = null; await render(); } catch (e) { panelSepolia('fund', st, errorBox(e)); }
    });
  } else if (p === 'send') {
    el.innerHTML = `<div class="ua-panel"><label>To</label><input id="uaTo" placeholder="0x…">
      <label>Amount (ETH)</label><input id="uaAmt" placeholder="0.001">
      <button class="ua-btn" id="uaSend">Sign and send</button>
      <p class="ua-note">Signed with a fresh one-time post-quantum key. Your wallet only delivers it (you will confirm the gas).</p>
      ${note}<div id="uaSendProg"></div></div>`;
    document.getElementById('uaSend').onclick = (ev) => withBusy(ev.currentTarget, async () => {
      const to = document.getElementById('uaTo').value.trim();
      const amt = document.getElementById('uaAmt').value.trim();
      const items = [
        { t: 'Checking the exact message with your account contract' },
        { t: 'Signing with a one-time post-quantum key' },
        { t: 'Delivering it', sub: 'confirm in your wallet' },
        { t: 'Confirmed on Sepolia' },
      ];
      const prog = document.getElementById('uaSendProg');
      const draw = () => { prog.innerHTML = progress(items); };
      const order = { review: 0, sign: 1, submit: 2, done: 3 };
      try {
        const done = await API.sendEth(to, amt, (step, info) => {
          const i = order[step];
          items.forEach((it, k) => { if (k < i) it.s = 'ok'; });
          if (step === 'sign' && info?.leaf != null) items[1].sub = `one-time key #${info.leaf}`;
          if (step === 'submit' && info?.leaf != null) items[1].sub = `one-time key #${info.leaf}, 2,508-byte LMS signature`;
          items[i].s = step === 'done' ? 'ok' : 'run';
          draw();
        });
        items.forEach((it) => { it.s = 'ok'; });
        const link = done?.txHash ? API.explorerTx(done.txHash) : null;
        items[3].sub = link ? `<a href="${link}" target="_blank">view on Etherscan</a>` : '';
        draw();
        setTimeout(() => { panel = null; render(); }, 2500);
      } catch (e) {
        const i = items.findIndex((it) => it.s === 'run');
        if (i >= 0) items[i].s = 'bad';
        draw();
        prog.insertAdjacentHTML('beforeend', errorBox(e));
      }
    });
  }
}

// ------------------------------------------------------------------------------------------- Frame transactions (future)

async function renderFrame() {
  if (!renderFrame.picked) {
    renderFrame.picked = true;
    const accts = (await API.state()).accounts.sort((x, y) => y.accountIndex - x.accountIndex);
    const best = accts.find((x) => x.address) || accts[0];
    if (best) await API.selectIndex(best.accountIndex);
  }
  const st = await API.state();
  if (!st.hasSeed) return viewKey();
  if (!st.minted && (!st.burner || st.burnerBalance === 0n)) return viewGas(st);
  if (!st.minted) return viewCreateFrame(st);
  return viewWalletFrame(st);
}

function viewGas(st, note = '', prog = null) {
  view().innerHTML = `${steps(2)}
    <h1>Free devnet gas</h1>
    <p>Frame transactions run on the EIP-8141 devnet. We create a throwaway setup key in your browser and get free
      devnet ETH from the faucet. It only pays for creating your account. It never controls it.</p>
    ${prog ? progress(prog) : '<button class="ua-btn" id="uaGas">Get free devnet gas</button><p class="ua-note">No wallet extension needed on this tab.</p>'}
    ${note}`;
  const b = document.getElementById('uaGas');
  if (!b) return;
  b.onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const items = [{ t: 'Creating a devnet setup key', s: 'run' }, { t: 'Asking the faucet' }];
    viewGas(st, '', items);
    try {
      if (!st.burner) await API.createBurner(false);
      items[0].s = 'ok'; items[1].s = 'run'; viewGas(st, '', items);
      await API.faucet();
      items[1].s = 'ok'; viewGas(st, '', items);
      await render();
    } catch (e) { viewGas(st, errorBox(e)); }
  });
}

function viewCreateFrame(st, note = '', prog = null) {
  view().innerHTML = `${steps(3)}
    <h1>Create your account</h1>
    <p>Same idea as today, without the wallet: the account checks your post-quantum signature itself and pays its own gas.</p>
    ${prog ? progress(prog) : '<button class="ua-btn" id="uaCreateF">Create my account</button><p class="ua-note">Generates your keys, mints the account and adds 0.05 devnet ETH to it.</p>'}
    ${note}`;
  const b = document.getElementById('uaCreateF');
  if (!b) return;
  b.onclick = (ev) => withBusy(ev.currentTarget, async () => {
    const items = [{ t: 'Generating 1,024 one-time keys', s: 'run' }, { t: 'Minting your account' }, { t: 'Adding 0.05 devnet ETH' }];
    viewCreateFrame(st, '', items);
    try {
      const idx = st.account && !st.minted ? st.account.accountIndex : API.nextIndex();
      await API.treeFor(idx);
      items[0].s = 'ok'; items[1].s = 'run'; viewCreateFrame(st, '', items);
      await API.mint();
      items[1].s = 'ok'; items[2].s = 'run'; viewCreateFrame(st, '', items);
      await API.fund('0.05');
      items[2].s = 'ok'; viewCreateFrame(st, '', items);
      await render();
    } catch (e) { viewCreateFrame(st, errorBox(e)); }
  });
}

function viewWalletFrame(st) {
  const badges = `<span class="ua-badge">Post-quantum protected</span><span class="ua-badge p">Zero ECDSA</span>
    <span class="ua-badge v">Pays its own gas</span>${st.staked ? '<span class="ua-badge">Staked</span>' : ''}`;
  view().innerHTML = walletHead(st.balance, st.address, badges) + activityHtml(st.log, API.explorerTx) +
    (st.staked ? '' : '<a class="ua-link" id="uaStake">Stake 0.012 ETH for the alternative mempool</a>');
  const sk = document.getElementById('uaStake');
  if (sk) sk.onclick = () => withBusy(null, async () => {
    sk.textContent = 'Staking (signed with your post-quantum key)…';
    try { await API.stake(); await render(); } catch (e) { sk.insertAdjacentHTML('afterend', errorBox(e)); sk.textContent = 'Stake 0.012 ETH for the alternative mempool'; }
  });
  bindWalletHead(st.address, (p) => panelFrame(p, st));
}

function panelFrame(p, st, note = '') {
  const el = document.getElementById('uaPanel');
  if (p === 'receive') {
    el.innerHTML = `<div class="ua-panel"><label>Your account address (devnet, chain 1337)</label><div class="ua-big-addr">${st.address}</div>
      <button class="ua-btn ghost" id="uaCopy">Copy address</button></div>`;
    document.getElementById('uaCopy').onclick = (ev) => copy(st.address, ev.currentTarget);
  } else if (p === 'fund') {
    el.innerHTML = `<div class="ua-panel"><label>Amount from the devnet setup key (ETH)</label><input id="uaFundAmt" value="0.05">
      <button class="ua-btn" id="uaFund">Add funds</button>${note}</div>`;
    document.getElementById('uaFund').onclick = (ev) => withBusy(ev.currentTarget, async () => {
      try { await API.fund(document.getElementById('uaFundAmt').value.trim()); panel = null; await render(); } catch (e) { panelFrame('fund', st, errorBox(e)); }
    });
  } else if (p === 'send') {
    el.innerHTML = `<div class="ua-panel"><label>To</label><input id="uaTo" value="${DEFAULT_TO}">
      <label>Amount (ETH)</label><input id="uaAmt" value="0.000001">
      <button class="ua-btn" id="uaSendF">Sign and send</button>
      <p class="ua-note">No wallet: the transaction carries only your post-quantum signature, and your account pays the gas.</p>
      ${note}<div id="uaSendProg"></div></div>`;
    document.getElementById('uaSendF').onclick = (ev) => withBusy(ev.currentTarget, async () => {
      const items = [
        { t: 'Signing with a one-time post-quantum key' },
        { t: 'Simulating the post-quantum check' },
        { t: 'Public mempool' },
        { t: 'Alternative mempool (ERC-8421)' },
        { t: 'On chain' },
      ];
      const prog = document.getElementById('uaSendProg');
      const draw = () => { prog.innerHTML = progress(items); };
      let i = 0;
      const run = (k) => { i = k; items[k].s = 'run'; draw(); };
      try {
        run(0);
        const r = await API.signFrame(document.getElementById('uaTo').value, document.getElementById('uaAmt').value);
        items[0].s = 'ok';
        items[0].sub = `one-time key #${r.leaf} · ${r.sigBytes.toLocaleString()}-byte LMS signature · 0 ECDSA`;
        run(1);
        const f = r.sim?.frames || [];
        if (r.sim?.executionStatus !== 'success') throw new Error(r.sim?.error || r.sim?.executionError || 'simulation failed');
        items[1].s = 'ok';
        items[1].sub = `${Number(f[0]?.gasUsed || 0).toLocaleString()} gas of validation, approved by your account`;
        run(2);
        const c = await API.submitCanonical();
        items[2].s = c.rejected ? 'bad' : 'ok';
        items[2].sub = c.rejected ? 'rejected: it only allows 100,000 gas of validation' : 'accepted';
        run(3);
        const res = await API.submitAlt((step) => { if (step === 'admitted') { items[3].s = 'ok'; run(4); } });
        items[3].s = 'ok';
        items[3].sub = res.checks ? `admitted · ${res.passed}/${res.checks} rules passed` : 'admitted';
        items[4].s = res.receipt && res.receipt.status === '0x1' ? 'ok' : 'bad';
        items[4].sub = `${res.receipt ? `block ${Number(res.receipt.blockNumber)} · ` : ''}<a href="${res.explorer}" target="_blank">view on the explorer</a>`;
        draw();
        setTimeout(() => { render(); }, 6000);
      } catch (e) {
        items[i].s = 'bad';
        draw();
        prog.insertAdjacentHTML('beforeend', errorBox(e));
      }
    });
  }
}

// ------------------------------------------------------------------------------------------- render loop

async function render() {
  if (getMode() !== 'user' || !API) return;
  try {
    if (PAGE === 'frame') await renderFrame(); else await renderSepolia();
  } catch (e) {
    view().innerHTML = errorBox(e);
  }
}

function boot() {
  API = PAGE === 'frame' ? window.QRACFAPI : window.QRACAPI;
  render();
}

shell();
apply(getMode());
if ((PAGE === 'frame' && window.QRACFAPI) || (PAGE !== 'frame' && window.QRACAPI)) boot();
else window.addEventListener('qrac:ready', boot, { once: true });
