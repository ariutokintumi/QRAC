# Feedback for the alt-mempool team (EIP-8141 / ERC-8421 devnet, docs, libraries)

From the QRAC team (post-quantum smart account, ETHGlobal), found while building on the public devnet on **7 Nov 2026**. Every item below was reproduced live; the steps are standalone (no QRAC code needed) unless noted.

Versions seen: ethrex `v23.0.0-eip8141-tracer-9aa3645d`, sidecar `forshtat/mempool-workshop-sidecar@2e22ff0`, workshop `forshtat/mempool-workshop@bcfe02a`, `@forshtat/hegota-support@0.0.1`, EIP-8141 page as published on 7 Nov 2026. The devnet may have been reset since: the tx hashes are examples, and any frame transaction reproduces the same behaviour.

| # | Area | Finding | Impact |
|---|---|---|---|
| F1 | Tooling (ethers / viem) | Standard JSON-RPC responses contain type-`0x06` transactions without `gas`/`nonce`/`to`/`value`: **ethers v6 throws**, **viem silently degrades** | High for developer experience: `tx.wait()` of an *ordinary* transaction can throw after a successful broadcast |
| F2 | Spec vs implementation | Signature hash: the EIP text replaces each elided signature by **its byte length**; the devnet codecs use **empty bytes**, and the devnet rejects the EIP-text variant | Medium: anyone implementing from the EIP text builds invalid signatures |
| F3 | Sidecar error messages | A replayed (already mined) frame tx is rejected with the **canonical** gas-budget message instead of the real reason (nonce already used) | Medium: misleading when debugging |
| F4 | Docs vs devnet behaviour | BUDGET-010 (100k for unstaked entities) is documented, but the devnet admits an **unstaked** sender with ~255k validation gas | Low/medium: changes the "stake to get admitted" story for high-gas validation |
| F5 | Docs | Devnet guide says "There is no faucet", but the gateway has `skandha_explorer_faucet`, and the workshop uses it | Low |
| F6 | Docs | Quickstart uses `npm`; the workshop README and lockfile use `yarn` v1 | Low |
| F7 | Library | `HegotaSupport` pins `pragma solidity 0.8.28` exactly; Remix with its default (newer) compiler fails until the user switches version | Suggestion |

---

## F1 — Frame transactions in standard RPC responses break ethers v6 and degrade viem

**What happens.** ethrex returns frame transactions in `eth_getTransactionByHash` and in `eth_getBlockByNumber(n, true)` with the frame-transaction shape (`frames`, `nonceKeys`, `nonceSeq`, `sender`, `signatures`, …) and **no** `gas`, `nonce`, `to`, `value`, `input`.

- **ethers 6.13.4** throws `invalid value for value.gasLimit (invalid BigNumberish value (argument="value", value=null, code=INVALID_ARGUMENT, version=6.13.4))` from `provider.getTransaction(frameTxHash)` **and** from `provider.getBlock(n, true)` for any block that contains a frame transaction.
- Consequence we hit: an ordinary EIP-1559 funding sent with `wallet.sendTransaction()` **was mined**, but `tx.wait()` threw this error. While waiting, ethers fetched a block that contained someone's frame transaction. A user sees "failed" and pays twice on retry.
- **viem 2.21.32** does not throw, but returns degraded objects: `getTransaction` → `type`, `gas`, `nonce` all `undefined`; `getBlock({ includeTransactions: true })` → `type: null` for frame transactions.
- Receipts are fine in both (`type: 6` / `"0x6"`, status parsed).

**Reproduce** (any browser console; the endpoint has permissive CORS):

```js
const { JsonRpcProvider } = await import('https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js');
const p = new JsonRpcProvider('https://altmempool.forshtat.com', 1337, { staticNetwork: true });
const FRAME_TX = '0x4544ca2e2c210b6df230f09edc762ef17902961f2c19767b17173be4bf87e9cd'; // any mined frame tx
await p.getTransaction(FRAME_TX);          // throws: invalid value for value.gasLimit … value=null
await p.getBlock(8195, true);              // throws the same (block containing FRAME_TX)
await p.getTransactionReceipt(FRAME_TX);   // OK: type 6, status 1

const viem = await import('https://cdn.jsdelivr.net/npm/viem@2.21.32/+esm');
const c = viem.createPublicClient({ transport: viem.http('https://altmempool.forshtat.com') });
(await c.getTransaction({ hash: FRAME_TX })).gas;   // undefined (also type, nonce)
```

**Suggestions:** document it prominently (it affects ordinary transactions too, not only frame transactions); ship formatters with `@forshtat/hegota-support` (an ethers v6 plugin / custom `formatTransaction`, and a viem chain `formatters.transaction` for type `0x06`); or have the RPC add compatible fields (for example `gas` = total of frame limits, `nonce` = `nonceSeq`). This fits the prize's "viem/ethers SDK" track.

**Our workaround:** for setup transactions we sign locally, send with `eth_sendRawTransaction` and poll `eth_getTransactionReceipt` ourselves.

---

## F2 — Signature hash: EIP text ≠ devnet codecs

**EIP-8141 text (Signature Hash):** "any signature with empty `msg` will have its raw `signature` bytes elided and replaced by their byte length", with `tx.signatures[i].signature = len(sig.signature)` and "The replaced `signature` field is RLP-encoded as an unsigned integer."

**Devnet codecs:** `@forshtat/hegota-support` `dist/tx/codec.js` `sigHash()` and the sidecar's `packages/executor/src/services/FrameTxService/codec.ts` `computeSigHash()` set the field to **empty bytes** (`signature: "0x"`). The sidecar's comment says "Per EIP-8141 §Signature Hash: elide raw signature bytes". ethrex accepts only this variant.

**Reproduce:** build a self-relay frame tx `[VERIFY(scope 3), SENDER(transfer)]` with one SECP256K1 signature entry (`msg` empty).

- Compute the hash with `signature` = empty bytes → sign → `eth_sendFrameTransaction` → **accepted** (our probe: hash `0xf96fe883…7161e`, mined, block 8052).
- Compute it per the EIP text (`signature` = RLP uint `65`) → sign → `eth_sendFrameTransaction` → **"Invalid frame transaction signature"**; `ethrex_simulateFrameTransaction` → `"canonicalMempoolViolation": "frame signature list does not authenticate the sender"`.

QRAC script: `tools/qrac/frametx.py` (`FrameTx.sig_hash`) and the one-off test recorded in our log.

**Suggestion:** align one side, or call out the divergence in the docs and in the codec comments. Committing to the signature length (the EIP way) also prevents length malleability of ARBITRARY signatures.

---

## F3 — Replay of a mined frame tx is rejected with the wrong reason

**What happens.** Resubmit the exact JSON of an already-mined frame transaction whose validation prefix declares more than 100k gas. The sidecar answers:

`prefix gas budget exceeded: 320100 > 100000 (MAX_VERIFY_GAS)`

The real reason, visible in the same `ethrex_simulateFrameTransaction` result, is `"executionError": "Invalid Transaction: Nonce mismatch: expected 1, got 0"` (the nonce key was already used). The canonical budget is not even a reason for the *alternative* mempool to reject: it admitted that same transaction the first time.

**Where (sidecar @2e22ff0):**
- `packages/executor/src/services/FrameTxSimulationService/index.ts` L141–147: `throw new RpcError(result.canonicalMempoolViolation ?? result.executionError ?? …)`.
- `packages/executor/src/services/UserOpValidation/validators/frameTx.ts` ~L380–386: the same precedence (canonical violation first).

Both functions' own comments say the canonical verdict is *not* the gate for the alternative mempool.

**Reproduce** (standalone):

```js
const rpc = async (u, m, p) => (await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());
const GW = 'https://altmempoolgateway.forshtat.com/rpc';
const HASH = '0x2f414a944f74a803e5d3e59eb98e9bd56f2c0a6e87be9bcf5cfa42e65026f4f0'; // mined frame tx, VERIFY limit 320k
const rep = await rpc(GW, 'skandha_explorer_getTransaction', [HASH]);
await rpc(GW, 'eth_sendFrameTransaction', [rep.result.entry.tx]); // -> "prefix gas budget exceeded: 320100 > 100000"
```

QRAC: `tools/devnet.py attacks` (first attack). **Suggestion:** when `executionError` is present, report it (or both), and do not surface `canonicalMempoolViolation` as the rejection reason of the alternative mempool.

---

## F4 — Unstaked sender admitted with ~255k validation gas

**Docs (rules/budget, BUDGET-010):** unstaked entities ≤ `MAX_VERIFY_GAS_PER_ENTITY` (100,000 in the draft); staked ≤ 1,000,000.

**Devnet:** a fresh, **unstaked** smart account whose VERIFY frame uses ~247k–255k gas was admitted (17/17 checks passed) and mined. `skandha_config` shows `"validationGasLimit": 10000000` and no per-entity cap. Examples: `0xbb5ce10aadd195c67ee266424bc465e6260d49c993b011bba2fe22f1554faf44` (block 8070), `0x55fd6e70a036206a0329527e8e0c552eba28d2747c1bc033e18f5d9096f5e117` (block 8182). Both senders were unstaked at the time; staking happened later.

The docs do say the reference implementation follows an earlier draft. **Suggestion:** state on the BUDGET-010 page that the devnet does not enforce the per-entity budget yet, since it changes what builders conclude about needing stake for high-gas validation (PQ wallets, privacy protocols).

**Reproduce:** deploy a sender whose VERIFY frame burns >100k gas (e.g. a loop of SHA-256 precompile calls), keep it unstaked, submit a self-pay frame tx to the gateway → admitted. QRAC: `tools/devnet.py init / fund / deploy / mint / send` (before `stake`).

---

## F5 — "There is no faucet" (devnet guide) vs the gateway faucet

**Docs (guides/devnet):** "It has no security model, no faucet and no persistence guarantee." / "There is no faucet." It also says funding comes from the shared genesis key ("The workshop's `step_1_check` does this for you").

**Reality:** the gateway exposes `skandha_explorer_faucet(address)` (1 ETH, once per hour per address), and the workshop's `step_1_check` uses it (`src/lib/chain.ts` `fundFromFaucet`), not the shared key. The devnet guide also does not list the gateway endpoint `https://altmempoolgateway.forshtat.com/rpc` that the workshop config uses for everything.

**Reproduce:** `rpc(GW, 'skandha_explorer_faucet', ['0x<new address>'])` → `{ txHash, amount: "1000000000000000000" }`.

---

## F6 — npm vs yarn

The docs Quickstart says "Node 20.12 or newer and npm" with `npm install` / `npm run step_…`. The workshop README says "yarn (v1)" with `yarn install` / `yarn step_…` and ships `yarn.lock`.

## F7 — Exact compiler pin in HegotaSupport

All `@forshtat/hegota-support` contracts use `pragma solidity 0.8.28;`. A contract importing them cannot be compiled with any other version (e.g. Remix's default latest compiler) until the user switches to exactly 0.8.28. Suggestion: `^0.8.28`, unless a specific version is required.

---

## What worked very well (for balance)

- `ethrex_simulateFrameTransaction` (with `canonicalMempoolValid` / `canonicalMempoolViolation` and per-frame gas) and the explorer's **admission report** made debugging fast.
- `HegotaSupport` works through an ERC-1167 clone: VERIFY frame → clone → implementation → `delegatecall` APPROVE helper. We expected this to be an open question; it just worked.
- EIP-8250 keyed nonces gave us **protocol-enforced one-time keys** for a hash-based (LMS) wallet with no storage writes in VERIFY.
- The faucet and the gossip between gateway and miner (~700 ms) were reliable throughout.
