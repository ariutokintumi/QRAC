# QRAC — step-by-step test guide

Use this to test everything yourself, and as the script for the demo video. Each step says what you should see.

## 0. Start

From the repository folder, in a terminal:

```bash
py -m http.server 8080 --directory apps/web
```

Open **http://localhost:8080**. Both modes are served from here. (Optional: `.venv\Scripts\python tools/devnode.py` serves the same dApp on port 8545 together with an offline local chain, for the Sepolia page's "Local dev node" option.)

## 1. Self-test (30 seconds)

Open **http://localhost:8080/test.html** → **"All 11 checks passed"**. The browser's SHA-256, LMS (including RFC 8554 Test Case 2), BIP-39, key derivation, authorization encoding and frame-transaction encoding are byte-identical to the Python references.

## 2. Current Ethereum · Sepolia (today, with tradeoffs)

Top switch: **"Current Ethereum · Sepolia"**. Needs Brave Wallet or MetaMask on Sepolia with a little test ETH.

1. **Setup:** if no seed yet, **Create new seed**: a secret `qrac-seed-….json` downloads. Choose *Browser wallet* → **Connect**. Verifier and factory are pre-filled (Sepolia).
2. **Account:** type a **new account number** (2, for example: #0 and #1 are already used on Sepolia) → **Generate key tree** (~1–3 s) → **Your account address** appears *before* it exists → **Mint account** (~738k gas) → put **0.02** → **Fund**.
3. **Compose & sign:** *Send ETH* → recipient → **0.001** → **Add to batch** → **Review**. Check "identical to the contract's authorizationMessage()" → **Sign** (a journal JSON downloads) → **Submit**. → Confirmed (~500k gas on Sepolia).
4. **Activity:** the action appears as *confirmed*, with an Etherscan link.
5. Optional extras:
   - switch to another Brave account and submit an exported authorization (anyone can deliver, only the PQ key decides);
   - a batch of two calls;
   - **Manage → Cancel** a signed but unsent action;
   - **Manage → Rotate** to a new key tree.

What this proves: an ECDSA wallet only delivers and pays; the account only obeys the post-quantum signature.

## 3. Future Ethereum · EIP-8141 frame transactions (no compromises)

Top switch: **"Future Ethereum · EIP-8141 frame transactions (devnet)"**.

**About Brave Wallet:** it is not used on this page, by design. No wallet (Brave, MetaMask, …) can sign EIP-8141 frame transactions yet, and QRAC does not need one: the post-quantum key in the dApp signs, and the account pays its own gas. The only ECDSA key involved is a throwaway devnet **setup key** that the page creates to pay for minting, funding and the staking transaction; it never has any right over the account.

1. **Seed and setup wallet:**
   - The seed shows **loaded**: it is the same 24-word seed as the Sepolia page; chain 1337 derives its own independent keys.
   - **Create devnet setup key** → **Get devnet ETH (faucet)** → the setup key shows **1.0 ETH** within a few seconds. The faucet allows once per hour per address; a new setup key is a new address.
2. **Your frame account:**
   - Account number **0** (any number not used before in this browser on this page).
   - **Generate key tree** (1–4 s) → **Mint account** → the address shows *minted*, "Public key matches seed: yes", *not staked*.
   - **Fund** 0.05 → Balance 0.05 ETH.
3. **Send a post-quantum frame transaction** (keep the default recipient and amount) → **Sign with a one-time key and simulate**. You should see:
   - Signatures in the transaction: **1 post-quantum (LMS, 2,508 bytes) · 0 ECDSA**.
   - One-time key → nonce key: **#0 (epoch 0) → 1, sequence 0**.
   - Simulation: **success**; VERIFY frame (PQ check) **~250,000 gas · approved**; SENDER frame 3,000 gas · ok.
   - Public mempool verdict: **not allowed**: prefix gas budget exceeded … > 100000.
   - Gas paid by: **the account itself**.
4. **Try the public (canonical) mempool** → **"Rejected by the public (canonical) mempool … exceeds MAX_VERIFY_GAS"**.
5. **Submit to the alternative mempool (ERC-8421)** → **admitted · 17/17 admission checks passed**, then **On chain · block … · success** (~10–20 s). Click the **Explorer** link: *On chain*, frame 0 *self-verification · payer*, **"Admission report: Every rule passed"**.
6. Optional: **Stake 0.012 ETH** → *staked 0.012 ETH, unstake delay 86400s* (signed by the PQ key, delivered through the account's `submit()` path by the setup key) → repeat step 3 and step 5.
7. **Activity:** every one-time key used, including the public-mempool attempt (that key is spent too, as it must be).

What this proves: on Ethereum with frame transactions the same account needs **no ECDSA at all**, pays its own gas, and the protocol enforces its one-time keys. The ~250k-gas post-quantum check only fits in the **alternative mempool**.

### Testing on a public domain

The site is static (`apps/web`); upload the folder to any static host with HTTPS. Browser data is **per site**: on the new domain the seed and journal start empty.

- **New seed:** Sepolia page → Setup → *Create new seed*.
- **Or continue with your existing accounts:** Setup → *Import seed file…* (your `qrac-seed-….json`), then Manage → *Import journal…* (your latest `qrac-journal-….json`). The frame page uses the same seed and journal.
- On the Sepolia page choose **Browser wallet** (the "Local dev node" option only works with `tools/devnode.py`).

## 4. Command line (the same Phase 3 story, scripted)

The devnet state of the original runs lives in `.devnet/` (git-ignored) on this computer.

```bash
.venv\Scripts\python tools/devnet.py status
```

```bash
.venv\Scripts\python tools/devnet.py send --route canonical
```

→ `REJECTED by the canonical mempool: … exceeds MAX_VERIFY_GAS`

```bash
.venv\Scripts\python tools/devnet.py send
```

→ `ACCEPTED by the alt mempool …` then `mined in block …`

```bash
.venv\Scripts\python tools/devnet.py attacks
```

→ four attacks (replay, tampering, wrong nonce key, ECDSA-only drain), then `ALL ATTACKS REJECTED`.

**If the devnet was reset** (contracts gone): `fund`, then `deploy`. `deploy` also updates `apps/web/deployments.json`, so the frame page follows. Then `mint`, `send`, etc.

## 5. Automated tests

```bash
.venv\Scripts\python tools/run_tests.py
```

→ **101 tests, OK.** This includes RFC 8554 vectors on-chain, the attacker with the deployer's ECDSA key, every account test on standalone, minted and frame accounts, and the factory rules.

## Where the evidence is

- Sepolia: [`deployments/11155111.md`](../deployments/11155111.md)
- Frame-transaction devnet: [`deployments/1337.md`](../deployments/1337.md)
- Decisions and measurements: [`qrac-ai-handoff/05-VITACORA.md`](../qrac-ai-handoff/05-VITACORA.md)
- Feedback for the alt-mempool team: [`docs/FEEDBACK-ALT-MEMPOOL.md`](FEEDBACK-ALT-MEMPOOL.md)
