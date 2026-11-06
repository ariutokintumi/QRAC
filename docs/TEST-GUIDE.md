# QRAC.me test guide

How to test everything by hand, from the website. Also works as the script for the demo video. Each step says what you should see.

## 0. Start

From the repository folder:

```bash
py -m http.server 8080 --directory apps/web
```

Open http://localhost:8080. The site opens in **User mode**, a simple wallet. The switch at the top right (Dev / User) changes to **Dev mode**, which shows every step and every option. Both modes share the same seed, journal and accounts, and the choice is remembered. Sections 3 and 4 use Dev mode. The same site is online at https://qrac.me, where you can follow the same steps.

(Optional: `.venv\Scripts\python tools/devnode.py` serves the same dApp on port 8545 with an offline local chain, for the "Local dev node" option of the Sepolia page.)

## 1. Self-test (30 seconds)

Open `/test.html`. You should see "All 11 checks passed". It checks that this browser computes SHA-256, LMS (including the official RFC 8554 Test Case 2), BIP-39, key derivation, the authorization message and the frame transaction encoding exactly like the Python references.

## 2. User mode (the simple wallet)

Two tabs at the top of the card: "Today · Sepolia" and "Future · EIP-8141". Each one walks you through a short wizard, then shows the wallet.

**Today · Sepolia** (needs Brave Wallet or MetaMask on Sepolia with a bit of test ETH):

1. "Your quantum-safe key": click "Create my key" (a secret `qrac-seed-….json` file downloads), or "I already have a key file".
2. "Connect a wallet to pay gas": click "Connect wallet". If the wallet is on another network you see "Switch to Sepolia"; switch in the wallet and click "I switched, reconnect".
3. "Create your account": click "Create my account". It builds the 1,024 keys and mints the account (your wallet confirms about 740k gas). The "Add funds" panel opens: put 0.05 and confirm.
4. The wallet: balance, your address (click to copy) and Send / Receive / Add funds. Send 0.01 to any address with "Sign and send": the progress shows the review, the post-quantum signature, the delivery by your wallet and the confirmation with its Etherscan link. The "one-time keys left" badge goes down by one.

**Future · EIP-8141** (no wallet extension):

1. Same key as the other tab (or create one).
2. "Free devnet gas": click "Get free devnet gas". It creates the throwaway setup key and uses the faucet.
3. "Create your account": click "Create my account". It builds the keys, mints the account and adds 0.05 devnet ETH.
4. The wallet shows the badges "Zero ECDSA" and "Pays its own gas". Send 0.001 with "Sign and send". The progress shows: signed (0 ECDSA signatures), simulated validation gas, public mempool rejected, alternative mempool admitted (17/17), and on chain with the block number and the explorer link. It takes 10 to 40 seconds.
5. Optional: "Stake 0.012 ETH for the alternative mempool". The badge "Staked" appears.

"Advanced options (Dev mode)" at the bottom of the card, or the switch, takes you to the full interface with the same account.

## 3. Current Ethereum, Sepolia (today)

In Dev mode (switch at the top right).

Click "Current Ethereum · Sepolia" at the top. You need Brave Wallet or MetaMask on Sepolia with a bit of test ETH.

1. Setup. If there is no seed yet, click "Create new seed" (a secret `qrac-seed-….json` file downloads). Choose "Browser wallet" and click "Connect". The verifier and the factory are filled in automatically on Sepolia.
2. Account. Type an account number you have not used on Sepolia (0 and 1 are taken with the current seed, so use 2). Click "Generate key tree" (1 to 3 seconds). "Your account address" shows the address before it exists. Click "Mint account" (about 738k gas), type 0.02 and click "Fund".
3. Compose & sign. Choose "Send ETH", put a recipient and 0.001, click "Add to batch", then "Review". The review must say the signed bytes are identical to the contract's `authorizationMessage()`. Click "Sign" (a journal file downloads), then "Submit". It confirms with about 500k gas.
4. Activity. The action shows as confirmed, with its Etherscan link.
5. Optional:
   - export the signed action and submit it from another wallet (anyone can deliver it, only the PQ key decides);
   - a batch of two calls;
   - Manage, "Sign cancel" for an action you signed but did not send;
   - Manage, "Prepare and sign rotation" to move to a new key tree.

This shows that an ECDSA wallet only delivers and pays, and that the account only obeys the post-quantum signature.

## 4. Future Ethereum, EIP-8141 frame transactions (devnet)

In Dev mode.

Click "Future Ethereum · EIP-8141 frame transactions (devnet)" at the top.

Brave Wallet is not used on this page, on purpose. No wallet can sign EIP-8141 frame transactions yet, and QRAC.me does not need one: the post-quantum key in the dApp signs and the account pays its own gas. The only ECDSA key involved is a throwaway devnet "setup key" that the page creates to pay for minting, funding and the staking transaction. It has no rights over the account.

1. Seed and setup wallet. The seed shows "loaded" (same seed as the Sepolia page; chain 1337 gets its own keys). Click "Create devnet setup key", then "Get devnet ETH (faucet)". After a few seconds the setup key shows 1.0 ETH. The faucet gives once per hour per address, and each new setup key is a new address.
2. Your frame account. Account number 0 (or any number you have not used on this page in this browser). Click "Generate key tree", then "Mint account". The address shows "minted", "Public key matches seed: yes" and "not staked". Click "Fund" with 0.05.
3. Send a post-quantum frame transaction. Keep the default recipient and amount and click "Sign with a one-time key and simulate". You should see:
   - Signatures in the transaction: 1 post-quantum (LMS, 2,508 bytes), 0 ECDSA.
   - One-time key #0 (epoch 0), nonce key 1, sequence 0.
   - Simulation: success. VERIFY frame (PQ check): about 250,000 gas, approved. SENDER frame: 3,000 gas, ok.
   - Public mempool verdict: not allowed (prefix gas budget over 100000).
   - Gas paid by the account itself.
4. Click "Try the public (canonical) mempool". It is rejected ("exceeds MAX_VERIFY_GAS").
5. Click "Submit to the alternative mempool (ERC-8421)". It is admitted with 17/17 admission checks passed, and after 10 to 20 seconds it shows "On chain", block number and success. Open the Explorer link: "On chain", frame 0 "self-verification, payer", and "Admission report: Every rule passed".
6. Optional: "Stake 0.012 ETH". The status changes to staked (0.012 ETH, unstake delay 86400s). The stake is signed with the PQ key and delivered through the account's `submit()` path by the setup key. Then repeat steps 3 and 5.
7. Activity lists every one-time key used, including the one sent to the public mempool (it is spent too, as it should be).

This shows that with frame transactions the same kind of account needs no ECDSA at all, pays its own gas, and that the protocol enforces its one-time keys. The 250k-gas post-quantum check only fits in the alternative mempool.

### On qrac.me (or any public domain)

The site is static (the `apps/web` folder). Browser data is kept per site, so on qrac.me the seed and the journal start empty even if you used the local version before.

- New seed: Sepolia page, Setup, "Create new seed".
- To keep using your existing accounts: Setup, "Import seed file…" (your `qrac-seed-….json`), then Manage, "Import journal…" (your latest `qrac-journal-….json`). The frame page uses the same seed and journal.
- On the Sepolia page choose "Browser wallet". "Local dev node" only works with `tools/devnode.py`.

## 5. Command line (same frame-transaction story)

The devnet state of the original runs is in `.devnet/` (git-ignored) on this computer.

```bash
.venv\Scripts\python tools/devnet.py status
```

```bash
.venv\Scripts\python tools/devnet.py send --route canonical
```

Expected: `REJECTED by the canonical mempool: … exceeds MAX_VERIFY_GAS`.

```bash
.venv\Scripts\python tools/devnet.py send
```

Expected: `ACCEPTED by the alt mempool …`, then `mined in block …`.

```bash
.venv\Scripts\python tools/devnet.py attacks
```

Expected: four attacks (replay, tampering, wrong nonce key, ECDSA-only drain), then `ALL ATTACKS REJECTED`.

If the devnet was reset (contracts gone), run `fund` and then `deploy`. `deploy` also updates `apps/web/deployments.json`, so the frame page follows. Then `mint`, `send`, and so on.

## 6. Automated tests

```bash
.venv\Scripts\python tools/run_tests.py
```

Expected: 101 tests, OK. They include the RFC 8554 vectors on-chain, an attacker holding the deployer's ECDSA key, every account test on standalone, minted and frame accounts, and the factory rules.

## Evidence

- Sepolia: [deployments/11155111.md](../deployments/11155111.md)
- Frame-transaction devnet: [deployments/1337.md](../deployments/1337.md)
- Decisions and measurements: [qrac-ai-handoff/05-VITACORA.md](../qrac-ai-handoff/05-VITACORA.md)
- Feedback for the alt-mempool team: [docs/FEEDBACK-ALT-MEMPOOL.md](FEEDBACK-ALT-MEMPOOL.md)
