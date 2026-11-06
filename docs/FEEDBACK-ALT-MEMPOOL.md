# Feedback for the alt-mempool team: errors we hit while building QRAC.me

QRAC.me (post-quantum smart account, ETHGlobal) built a frame-transaction wallet on the public devnet on **7 Nov 2026**. This page lists only the errors and surprises **we actually ran into** during development and testing, where the cause turned out to be on the devnet / sidecar / docs side, and how we worked around each one. Errors that were ours are not listed.

Versions at the time: ethrex `v23.0.0-eip8141-tracer-9aa3645d`, sidecar `forshtat/mempool-workshop-sidecar@2e22ff0`, workshop `forshtat/mempool-workshop@bcfe02a`. The devnet may have been reset since; the hashes are examples, and any frame transaction reproduces the same behaviour.

| # | What we hit | Cause | Our workaround |
|---|---|---|---|
| 1 | A funding transaction was reported as **failed** by ethers, but it had been **mined** | Standard RPC responses contain frame transactions (type `0x06`) that ethers v6 cannot parse | Send setup transactions raw and poll receipts ourselves |
| 2 | Replaying a mined frame transaction was rejected with an **unrelated reason** (gas budget) | Sidecar reports the canonical-mempool violation before the real execution error | Checked `ethrex_simulateFrameTransaction` to find the real reason |
| 3 | Our **unstaked** account (~255k validation gas) was **admitted**, although the docs say unstaked entities get 100k | The devnet sidecar does not enforce the per-entity budget (BUDGET-010) | None needed; we stake anyway and documented the difference |
| 4 | The devnet guide says **"There is no faucet"** and to fund from the shared genesis key | The gateway does have a faucet (`skandha_explorer_faucet`), and the workshop uses it | Used the faucet (never needed the shared key) |

---

## 1. ethers v6 reports a mined transaction as failed

**What happened.** On our dApp's devnet page, a plain EIP-1559 funding (`wallet.sendTransaction({ to, value })`, ethers 6.13.4) threw:

`invalid value for value.gasLimit (invalid BigNumberish value (argument="value", value=null, code=INVALID_ARGUMENT, version=6.13.4))`

The transaction **was mined**. A user who believes the error retries and pays twice (we did, by accident).

**Cause.** ethrex returns frame transactions inside the standard `eth_getTransactionByHash` and `eth_getBlockByNumber(n, true)` responses, with the frame shape (`frames`, `nonceKeys`, `nonceSeq`, …) and no `gas`/`nonce`/`to`/`value`. While waiting, `tx.wait()` read a block that contained a frame transaction, and ethers' formatter threw on it. Receipts parse fine.

**Reproduce** (any browser console):

```js
const { JsonRpcProvider } = await import('https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js');
const p = new JsonRpcProvider('https://altmempool.forshtat.com', 1337, { staticNetwork: true });
const FRAME_TX = '0x4544ca2e2c210b6df230f09edc762ef17902961f2c19767b17173be4bf87e9cd'; // any mined frame tx
await p.getTransaction(FRAME_TX);   // throws: invalid value for value.gasLimit … value=null
await p.getBlock(8195, true);       // throws the same (block containing FRAME_TX)
```

**Suggestion:** a warning in the docs (it affects ordinary transactions, not only frame transactions), and/or an ethers formatter for type `0x06` in `@forshtat/hegota-support`.

## 2. Replay rejected with a misleading reason

**What happened.** One of our security tests resubmits an already-mined QRAC.me frame transaction to the gateway. It was rejected (correct), but with:

`prefix gas budget exceeded: 320100 > 100000 (MAX_VERIFY_GAS)`

That reason is wrong for the alternative mempool, which had admitted the same transaction the first time. `ethrex_simulateFrameTransaction` showed the real one: `"executionError": "Invalid Transaction: Nonce mismatch: expected 1, got 0"`.

**Cause** (sidecar @2e22ff0): the error is built as `canonicalMempoolViolation ?? executionError ?? …` (`FrameTxSimulationService/index.ts` L141–147; same precedence in `validators/frameTx.ts` ~L380–386).

**Reproduce:**

```js
const rpc = async (u, m, p) => (await (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());
const GW = 'https://altmempoolgateway.forshtat.com/rpc';
const HASH = '0x2f414a944f74a803e5d3e59eb98e9bd56f2c0a6e87be9bcf5cfa42e65026f4f0'; // mined frame tx, VERIFY limit 320k
const rep = await rpc(GW, 'skandha_explorer_getTransaction', [HASH]);
await rpc(GW, 'eth_sendFrameTransaction', [rep.result.entry.tx]); // -> "prefix gas budget exceeded: 320100 > 100000"
```

**Suggestion:** report `executionError` when present (or both reasons).

## 3. Unstaked sender admitted with ~255k validation gas

**What happened.** Following the docs (BUDGET-010: unstaked ≤ 100,000; staked ≤ 1,000,000), our "before staking" test expected the alternative mempool to refuse our unstaked account. It was **admitted** (17/17 checks) and mined, e.g. `0xbb5ce10aadd195c67ee266424bc465e6260d49c993b011bba2fe22f1554faf44` (block 8070). `skandha_config` shows `"validationGasLimit": 10000000`.

**Note:** the docs mention that the implementation follows an earlier draft. A line on the BUDGET-010 page saying the devnet does not enforce the per-entity budget yet would have saved us the investigation.

## 4. "There is no faucet"

**What happened.** The devnet guide says "There is no faucet" and to fund a new key from the shared genesis key. While reading the workshop code we found `skandha_explorer_faucet(address)` on the gateway (1 ETH, once per hour per address), which `step_1_check` uses. We used it instead of the shared key. The guide also does not list the gateway endpoint (`https://altmempoolgateway.forshtat.com/rpc`) that the workshop sends everything through.

---

## What worked very well

- `ethrex_simulateFrameTransaction` and the explorer's **admission report** made every investigation quick.
- `HegotaSupport` worked through an ERC-1167 clone (VERIFY frame, then the clone, the implementation and the APPROVE helper by `delegatecall`) on the first try.
- EIP-8250 keyed nonces gave our hash-based wallet **protocol-enforced one-time keys**.
- The faucet and gossip from gateway to miner were reliable all day.
