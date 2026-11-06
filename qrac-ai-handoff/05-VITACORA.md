# QRAC — Vitácora (decision log)

Running, human-readable record of how the project evolved: the general direction at each stage, the decisions taken and the outcomes produced. It records **decisions and results only**. Code, tests and other artifacts live in the repository and are referenced from here.

Entries are in chronological order. When an entry contradicts an earlier document (01–04), **the most recent entry wins**.

Status labels used below:

- **Decided**: agreed direction; we build on it.
- **Proposed**: engineering default chosen by the developing AI, open to change by the team.
- **Open**: still to be decided, normally with measurements.
- **Done**: implemented and verified (with a pointer to evidence).

---

## Stage 0 — Origin (before 6 Nov 2026)

### 0.1 Initial research in Gemini

- **Prompt (general):** check whether a reusable on-chain contract could verify disposable quantum-resistant signatures so that existing protocols could protect their users' operations today, without waiting for Ethereum protocol upgrades.
- **Outcome:** confirmed the broad feasibility of hash-based one-time signatures (Lamport / Winternitz family) on today's EVM. Several claims from that stage were later corrected (see 0.2): "zero quantum attack opportunity", automatic forward secrecy, 12-word seeds giving 256-bit entropy, tx.origin-based binding, ECDSA-signed enrollment as the security anchor, and a fixed gas estimate.
- The raw transcript is kept **locally only** (`reference-first-gemini-conversation.txt`, git-ignored). It is anecdotal context, not a specification.

### 0.2 Planning in ChatGPT (Astra)

- **Prompt (general):** turn the idea into a sound, scoped architecture and a handoff package that another AI can execute.
- **Outcome:** the handoff package in this folder (documents 00–04). Key decisions taken at that stage:

| # | Decision | Status |
|---|---|---|
| D-0.1 | **Pivot**: instead of every protocol integrating a guard, each user gets their own **contract account** that verifies the PQ signature before calling ordinary protocols. | Decided |
| D-0.2 | Authority = an **independent PQ key** (hash-based, stateful). No permanent owner EOA, no ECDSA reset/upgrade/bypass path. | Decided |
| D-0.3 | Use a **Merkle tree of one-time keys** (LMS / LM-OTS family) instead of "rotate the single key on every tx", so a failed or dropped tx never strands the account. | Decided |
| D-0.4 | Seed: **24 BIP-39 words = 256 bits** of fresh, independent entropy (supersedes 12 words). | Decided |
| D-0.5 | Sign the **exact action** (chain, account, epoch, nonce, leaf, calls, submitter, validity window). Use `msg.sender` only for the optional submitter restriction; never `tx.origin` for ownership. | Decided |
| D-0.6 | Any EOA can pay gas and submit (open mode), or the signature names an allowed submitter (restricted mode). | Decided |
| D-0.7 | Shared fixed logic + small per-user accounts (factory, ERC-1167-style clones), atomic initialization. | Decided |
| D-0.8 | Signer must reserve a one-time key **before** signing and never reuse it, even if the tx fails or is never sent. | Decided |
| D-0.9 | Honest claims only: no full privacy, no MEV protection, no Safe parity, no unmeasured gas figures. | Decided |
| D-0.10 | First crypto candidate to benchmark: **LMS SHA-256, n=32, h=10, LM-OTS w=4** (RFC 8554). | Proposed |

---

## Stage 1 — Development in Claude Code (Opus 5.5, high effort)

### 6 Nov 2026 — Session 1: kickoff

**General prompt:** read the handoff package, rename the project, set up the decision log and the README, define the development roadmap and start the MVP.

#### Decisions

| # | Decision | Status |
|---|---|---|
| D-1.1 | Project name is **QRAC** (**QR Accounts**). Every "QRSC Account" / "QRSC" reference was replaced. | Decided · Done |
| D-1.2 | The Gemini transcript is excluded from the repo through `.gitignore`. | Decided · Done |
| D-1.3 | This vitácora (`05-VITACORA.md`) is the running source of truth for decisions. The README is the public face of the repo. | Decided · Done |
| D-1.4 | **Phased roadmap** replaces the "single release" framing of documents 02–03 (see table below). Documents 01–04 remain valid for the security model and the claim boundaries. | Decided |
| D-1.5 | **Prize target:** ETHGlobal "Best use of the Frame Transaction Alternative Mempool" (EIP-8141 frame transactions + ERC-8421 alternative mempool), category *"something only an alt mempool makes possible"*: a **PQ-secure smart wallet** whose verification needs more than the public mempool's 100k verification-gas budget. This reverses the earlier exclusion of native account abstraction for Phase 3 only; **ERC-4337 remains out of scope**. | Decided |
| D-1.6 | Phase 1 dApp: **plain HTML + CSS + JavaScript, no backend, no build step**. Developer-mode PoC. Signer state goes to `localStorage` **and** a JSON file is downloaded after every signature (the user keeps it as backup). | Decided |
| D-1.7 | Phase 1 "logic contract" = a **stateless, shared PQ verifier** (pure verification: message + signature + public key → valid/invalid). Phase 1 "user contract" = the **account** that holds assets and state (root, epoch, action nonce, consumed leaves) and calls the verifier. | Decided |
| D-1.8 | **Design for EIP-8141 from day one:** keep the verifier free of state writes so that the same code can later run inside a frame-transaction `VERIFY` frame (which executes as a static call; only `APPROVE` changes state there). | Proposed |
| D-1.9 | In Phase 1 the account is deployed directly (constructor sets the initial PQ configuration; the deployer keeps no rights). The factory/"mint" arrives in Phase 2. | Proposed |
| D-1.10 | ~~Toolchain: Solidity + Foundry for contracts and tests~~ (superseded by D-1.12). The dApp loads pinned libraries from a CDN (no npm build). | Superseded in part |
| D-1.11 | Phase 1 also includes: an automated test suite (valid/invalid signatures, tampering, replay, "attacker holds the deployer's EOA key"), a gas benchmark, and a local-chain demo script. This is the answer to "anything else?" in the roadmap. | Proposed |

#### Roadmap

| Phase | Scope | Status |
|---|---|---|
| **1 — MVP** | 1.1 PQ verifier contract (general logic). 1.2 User account PoC ("Safe-equivalent", single PQ authority, CALL and atomic batch, replay protection). 1.3 dApp (HTML/CSS/JS, signature generation, localStorage + JSON download, developer mode). 1.4 Tests, gas benchmark, local demo script. | In progress |
| **2 — Mint** | On-chain factory so any user can **mint** (deploy and initialize atomically) their own QRAC account from the dApp; root renewal and cancellation flows polished. | Planned |
| **3 — Frame transactions / alt mempool** | QRAC account validates EIP-8141 frame transactions natively in a `VERIFY` frame and calls `APPROVE`. Submission through the ERC-8421 alternative mempool on the hackathon devnet, using a staked sender to get the larger verification budget. Qualifying evidence: link to an admitted tx on the devnet explorer and the code that submits it. | Planned |

#### Facts gathered for Phase 3 (from the public drafts, to be re-checked on site)

- EIP-8141 frame transaction: type `0x06`; frames have modes `DEFAULT`, `VERIFY` (static call; only `APPROVE` changes state) and `SENDER`. Custom signatures use the `ARBITRARY` scheme and are read by account code (`SIGDATACOPY`).
- Public mempool limit for the validation prefix: **100,000 verification gas**.
- ERC-8421 standard alternative mempool: **100,000** verification gas per unstaked entity, **1,000,000** per staked entity (stake registry, ~USD 1000 equivalent, 1-day unstake delay, never slashed), with reputation (seen/included) and throttling rules. Keyed nonces (EIP-8250) are supported.
- Implication: a hash-based PQ signature check is expected to exceed 100k gas (to be **measured**, no number is claimed yet), which makes the alt mempool a requirement, not an optimization.

#### Open questions (to resolve with evidence)

| # | Question | Notes |
|---|---|---|
| O-1.1 | Final LMS parameters (tree height, Winternitz `w`) for the demo. | `w` resolved by measurement: W4 (D-1.17). Tree height H10 stays provisional until browser key generation is measured. |
| O-1.2 | Where to record "leaf consumed" under EIP-8141, given that `VERIFY` frames cannot write storage. | Candidates: map the one-time-key index to an EIP-8250 nonce key (protocol enforces one use), or mark it in a following `SENDER` frame. Decide in Phase 3 with the devnet. |
| O-1.3 | ~~Which testnet to use for the Phase 1 public demo.~~ | Resolved: Sepolia (D-1.16). |
| O-1.4 | Exact devnet RPC, explorer, faucet and submission method for the alt mempool. | Obtain on site from the alt-mempool team. |

#### Outcomes of this session

- Handoff documents renamed to QRAC.
- `.gitignore` created (Gemini transcript, secrets, build outputs).
- This vitácora created.
- `README.md` rewritten for the project.
- Development environment check: git, Node.js and Foundry were not available on the development machine. Resolved by the toolchain decisions below.

### 6 Nov 2026 — Session 1, continued: toolchain, license and network

**General prompt:** keep the tooling to the minimum; confirm license and demo network.

| # | Decision | Status |
|---|---|---|
| D-1.12 | **Minimal toolchain.** No Foundry, no Hardhat, no Node.js. Contracts are compiled and deployed by the team with **Remix IDE** (browser). Everything that runs locally runs on **Python 3** (standard library first). | Decided |
| D-1.13 | **Python's role:** (a) serve the dApp at `http://localhost` (browsers block Web Workers and ES modules on `file://`, and the key-tree generation needs a worker); (b) a **reference LMS signer/verifier** used to produce and cross-check test vectors (including RFC 8554 vectors); (c) an automated **contract test and gas-benchmark script** running against a local in-memory EVM. (c) is the only part that needs extra pip packages; they are installed into a local virtual environment and pinned in `requirements.txt`. | Decided (c: Proposed) |
| D-1.14 | **Git** is used for version history (every change is auditable and reversible) and to publish the public GitHub repository that the ETHGlobal submission requires. | Decided |
| D-1.15 | **License: MIT.** | Decided · Done |
| D-1.16 | **Public demo network for Phases 1–2: Sepolia.** Phase 3 uses the hackathon frame-transaction devnet and its alternative mempool. | Decided |

Environment status: git 2.56 installed and configured. Python 3 still to be installed (the `python` command on the machine is only the Windows Store placeholder).

### 6 Nov 2026 — Session 1, continued: Phase 1.1 PQ verifier

**General prompt:** start development with the shared PQ verifier ("general logic contract").

#### Decisions

| # | Decision | Status |
|---|---|---|
| D-1.17 | **Parameter set for QRAC accounts: `LMS_SHA256_M32_H10` + `LMOTS_SHA256_N32_W4`** (RFC 8554). Chosen by measurement (table below): W8 costs more than 1M gas and is rejected; W2 saves execution gas but nearly doubles the signature (4,620 vs 2,508 bytes), which cancels the saving in calldata and makes frame transactions heavier. | Decided (H10 provisional, see O-1.1) |
| D-1.18 | The verifier accepts **every RFC 8554 SHA-256 (n = m = 32) parameter set**, so the official RFC test vectors can be checked on-chain. The **account pins its own parameter set** inside its stored public key, so a different set cannot be substituted for an account. | Decided |
| D-1.19 | The per-signature randomizer `C` is derived deterministically (RFC 8554 Appendix A). This reproduces the RFC's signature byte for byte. It is safe only because a one-time key never signs twice, which the signer journal must enforce (D-0.8). | Decided |
| D-1.20 | The verifier is **stateless, ownerless and storage-free**, uses only the SHA-256 precompile, and returns `false` (never reverts) on malformed input. It compiles with **default Remix settings** (no `viaIR`); tested with solc 0.8.28, EVM target Cancun. | Decided · Done |
| D-1.21 | Local harness: Python virtual environment with `py-solc-x` (compiler) and `eth-tester` + `py-evm` (in-memory EVM), pinned in `tools/requirements.txt`. `eth-tester` is installed **without** its `[py-evm]` extra, because that extra pins an old dependency that does not build on Python 3.13 / Windows. Use the `py` launcher on this machine (`python` points to the Windows Store placeholder). | Decided · Done |

#### Evidence

Command (from the repository root): `.venv\Scripts\python tools/run_tests.py` → **19 tests, all passing.**

| Check | Result |
|---|---|
| RFC 8554 Test Cases 1 and 2 (HSS, two levels each) verify in the Python reference | Pass |
| RFC Test Case 2 top tree (H10/W4) rebuilt from the published SEED and I: public key **and** signature reproduced byte for byte | Pass |
| Every leaf of an H5 tree signs and verifies; a one-bit flip in **every** byte of the signature or public key is rejected; wrong lengths and an out-of-range leaf are rejected (Python) | Pass |
| On-chain verifier accepts each LMS level of both RFC test cases and rejects a modified message | Pass |
| On-chain verifier agrees with the Python reference on random messages (0 to 1,000 bytes), random leaves and boundary leaves (0, 1, 1022, 1023) | Pass |
| On-chain verifier rejects bit flips in every signature region (leaf index, OTS type, C, chain values, LMS type, authentication path), public-key flips, extended or truncated messages and keys from another tree | Pass |
| Malformed inputs (empty or short or long signature or key, leaf index out of range, unsupported types) return `false` without reverting | Pass |

#### Measurements

Environment: py-evm 0.12.1b1 (Cancun rules), solc 0.8.28, optimizer on (200 runs). Gas is the **execution gas of `verify()` alone**, measured with a probe contract (no transaction base cost, no calldata cost). 10 random 320-byte messages per row.

| Parameter set | Signature size | Verify gas min / avg / max |
|---|---|---|
| **H10 / W4 (chosen)** | 2,508 bytes | **171,947 / 194,617 / 219,902** |
| H10 / W2 | 4,620 bytes | 136,934 / 142,598 / 147,410 |
| H10 / W8 | 1,452 bytes | 1,070,716 / 1,345,301 / 1,664,406 |

Other figures: verifier runtime bytecode 2,438 bytes; Python key-tree generation for 1,024 one-time keys (H10/W4) about 0.45 s on the development machine.

**Consequence for Phase 3:** PQ verification alone costs about 170k–220k gas, above both the public mempool's 100k verification budget and ERC-8421's 100k budget for unstaked entities, and well inside the 1M budget for **staked** entities. The QRAC account therefore needs the alternative mempool **with a staked sender**. This is exactly the prize's "verification budget higher than 100k" category, now backed by a measurement instead of an estimate.

#### Files produced

- `contracts/LMSVerifier.sol`: the shared verifier.
- `contracts/test/GasProbe.sol`: test-only gas measurement helper.
- `tools/qrac/lms.py`: Python reference LMS / LM-OTS (key generation, signing, verification, HSS verification for the RFC vectors).
- `tools/qrac/evm.py`: local compile-and-run harness.
- `tools/extract_rfc8554_vectors.py` and `tools/vectors/rfc8554.json`: RFC 8554 Appendix F test vectors.
- `tools/tests/`: reference and on-chain test suites; `tools/run_tests.py` runs them all.

#### Next

Phase 1.2: the QRAC account contract (authorization encoding, nonce, epoch and consumed-leaf state, open or restricted submitter, validity window, atomic batches, root rotation and cancellation), with tests that include an attacker holding the deployer's EOA key.

### 6 Nov 2026 — Session 1, continued: Phase 1.2 QRAC account

**General prompt:** build the user account contract ("Safe-equivalent" PoC) on top of the verifier.

#### Decisions

| # | Decision | Status |
|---|---|---|
| D-1.22 | **Signed message format (v1):** `abi.encode(DOMAIN, chainId, account, epoch, nonce, leaf, kind, allowedSubmitter, validAfter, validUntil, payload)`, where `DOMAIN = keccak256("QRAC.Authorization.v1")`. The **account rebuilds these bytes itself** from the submitted fields, so a submitter cannot swap in different bytes. The full bytes are signed; there is no separate pre-hash. | Decided · Done |
| D-1.23 | **Three action kinds.** `EXECUTE` = ordered batch of CALLs `{target, value, data, checkReturn}`. `ROTATE` = `(newPublicKey, nextEpoch)`. `CANCEL` = empty payload, consumes the nonce and nothing else. | Decided · Done |
| D-1.24 | **One state-changing entry point, `submit()`.** No owner, admin, upgrade, module, `DELEGATECALL` or ECDSA path. The other functions are views, `receive()` (accepts funds only) and the ERC-721 / ERC-1155 receiver callbacks (pure, grant nothing). A test enforces this on the compiled ABI. | Decided · Done |
| D-1.25 | **Order of operations:** check kind, epoch, nonce, submitter, validity window and unused leaf; verify the PQ signature; mark the leaf used and advance the nonce **before** any external call; then execute. A reentrancy lock blocks nested `submit()`. If the transaction reverts, nothing is consumed on-chain, but the signer must still treat that leaf as spent (D-0.8). | Decided · Done |
| D-1.26 | **Batch rules:** 1 to 32 calls, all-or-nothing, calls to the account itself refused. Per-call **signed** `checkReturn` flag: when set, the call must return nothing or exactly `true` (ERC-20 style). Without it, a call is opaque: success means only "did not revert". Return data is never copied wholesale (protects against "return-data bombs"); revert reasons are truncated to 256 bytes. | Decided · Done |
| D-1.27 | **Key rotation:** the next epoch must be exactly current + 1; the parameter set (LMS and LM-OTS types) is fixed for the account's lifetime; any key ever installed (fingerprint = keccak256 of the 56-byte public key) can never be installed again. The action nonce is **never reset**. | Decided · Done |
| D-1.28 | The contract exposes `authorizationMessage(header, leaf, payload)` so the dApp can fetch the exact bytes to sign and cross-check its own encoding before signing. | Decided · Done |
| D-1.29 | Phase 1 deploys the account directly through its constructor (`verifier`, `initialPublicKey`); the deployer gets no rights. Deployment costs about 1.54M gas. The Phase 2 factory (ERC-1167 clones) is expected to cut this sharply (to be measured). | Decided |
| D-1.30 | **Known limit, enforced off-chain:** the contract cannot detect the same LMS key being used in two accounts, which would reuse one-time keys. The dApp's key derivation must give every account (and every epoch) its own, independent tree. | Decided (dApp to implement) |

#### Evidence

Command (from the repository root): `.venv\Scripts\python tools/run_tests.py` → **44 tests, all passing** (19 from Phase 1.1 + 25 account tests). All account tests use **real LMS signatures and the real verifier**; nothing is mocked except external tokens and targets.

| Check | Result |
|---|---|
| Contract `authorizationMessage` matches the Python reference encoder byte for byte (all kinds, several payloads) | Pass |
| ETH transfer authorized by PQ signature, delivered by an unrelated relayer EOA | Pass |
| **Simulated ECDSA compromise:** the deployer/funder EOA sends valid transactions with random bytes, a valid signature from its own LMS key, or an empty signature, and calls non-existent functions: every attempt is refused and the funds stay | Pass |
| Only `submit()` can change state (compiled ABI check) | Pass |
| Replay refused; changes to recipient, amount, submitter, validity window, kind or leaf index invalidate the signature | Pass |
| Signature for another chain ID or another account refused; two accounts keep independent state | Pass |
| Restricted submitter: other EOAs refused, allowed EOA succeeds; consecutive actions through different, fresh EOAs need no owner change | Pass |
| Expired and not-yet-valid authorizations refused; the same signed bytes succeed once the window opens (exact retry, no re-signing) | Pass |
| A leaf already used on-chain is refused, even for a new nonce | Pass |
| A failed batch reverts everything (target, nonce, leaf); a replacement with a fresh leaf and the same nonce succeeds; the failed original can never succeed afterwards | Pass |
| Two competing authorizations for the same nonce: only the first lands | Pass |
| Cancel consumes the nonce and invalidates a pending action; a cancel with a payload is refused | Pass |
| Rotation: epoch +1, nonce not reset, old key and old-epoch authorizations refused, new key works; reinstalling a past key, changing the parameter set or skipping an epoch is refused | Pass |
| Bad constructor keys (wrong length, unsupported types) refused | Pass |
| ERC-20 transfer + approve + revoke in one atomic batch; a false-returning token is refused when checked; a no-return token is accepted when checked | Pass |
| Self-call, empty batch and 33-call batch refused; a 100 KB revert-data bomb is truncated to 256 bytes | Pass |
| Re-entrant `submit()` from a called contract is blocked | Pass |
| NFT received through `safeTransferFrom` (no state change, no authority) and sent out by an authorized call | Pass |

#### Measurements (LMS H10/W4, total transaction gas including the 21k base and calldata)

Measured on the local py-evm chain. Each run uses fresh random keys, so figures vary by roughly ±30k between runs (the signature check alone ranges 172k–220k, see Phase 1.1). These are first-use figures: they include writing storage slots from zero (nonce, leaf bitmap), which costs more than later actions.

| Action | Gas (one run) | Calldata bytes |
|---|---|---|
| Deploy LMSVerifier (once per chain) | 580,446 | 2,466 (code) |
| Deploy QRACAccount | 1,539,374 | 7,134 (code) |
| Send ETH (1 call) | 324,773 | 3,108 |
| ERC-20 transfer (1 call) | 312,833 | 3,204 |
| Batch of 5 calls | 335,393 | 4,164 |
| Cancel nonce | 286,934 | 2,852 |
| Rotate key | 312,565 | 3,012 |

Takeaway: a QRAC action costs about **285k–345k gas**, of which roughly two thirds is the post-quantum signature check. Extra calls in a batch are cheap compared with the fixed verification cost.

#### Files produced

- `contracts/QRACAccount.sol`: the account (includes the `ILMSVerifier` interface, so it deploys from Remix as a single file next to `LMSVerifier.sol`).
- `contracts/test/Mocks.sol`: test-only tokens, targets, re-entrancy attacker, NFT.
- `tools/qrac/authorization.py`: reference encoder for the signed message and payloads.
- `tools/tests/test_account_evm.py`: account test suite and gas report.

#### Next

Phase 1.3: the dApp (HTML + CSS + JS, no backend): 24-word seed, key-tree generation in a browser worker, signer journal (localStorage + JSON download after every signature), compose → review → sign → submit through the connected wallet, and account status. The browser signer must reproduce the Python reference and the contract's `authorizationMessage` byte for byte.

### 6 Nov 2026 — Session 1, continued: Phase 1.3 dApp

**General prompt:** build the dApp (HTML + CSS + JS, no backend, developer mode) to create, operate and manage a QRAC account.

#### Decisions

| # | Decision | Status |
|---|---|---|
| D-1.31 | **Key derivation v1:** BIP-39 seed (24 words, empty passphrase) → for each `(chainId, accountIndex, epoch)`: `treeSeed = HMAC-SHA256(seed, "QRAC/v1/lms-seed" ‖ 0x00 ‖ u64 chainId ‖ u32 accountIndex ‖ u32 epoch)`, `I = HMAC-SHA256(seed, "QRAC/v1/lms-I" ‖ …)[0:16]`. Every account, chain and epoch gets an independent tree, which implements D-1.30. | Decided · Done |
| D-1.32 | **Tree height H10 confirmed** (closes O-1.1): the browser builds the 1,024-key tree in about 1–2.3 s in a Web Worker and signs in about 2–15 ms. | Decided |
| D-1.33 | **Signer journal:** a one-time key is reserved and saved to `localStorage` **before** signing; reserved keys are never released (failed, reverted or never-sent actions included); import merges by taking the higher counter; tabs are serialized with the Web Locks API; the last **8 keys of each tree are reserved for rotation**. Before signing, the dApp also asks the contract whether that key was already used on-chain. | Decided · Done |
| D-1.34 | **Secrets:** developer mode keeps the 24 words in `localStorage` (warning banner shown). The journal JSON, downloaded after every signature by default, **contains no secrets**; restoring needs the words **and** the latest journal. | Decided · Done |
| D-1.35 | **Words alone do not allow signing:** when an account with on-chain activity is attached and this browser's journal knows nothing about it, signing is **locked** until a journal is imported. | Decided · Done |
| D-1.36 | **Exact-intent review:** before signing, the dApp encodes the message locally **and** calls the contract's `authorizationMessage()`; it refuses to sign unless both are byte-identical. Each call is also simulated from the account's address (best effort, shown as such). | Decided · Done |
| D-1.37 | Gas payment is separate from authority: any connected wallet can submit; an authorization can be **exported as JSON** and delivered by another EOA. A mined revert is explained by re-simulating it. | Decided · Done |
| D-1.38 | **Two ways to deploy:** from the dApp (it ships the compiled ABI + bytecode in `apps/web/artifacts/`, built by `tools/build_web_artifacts.py`) or with Remix (the dApp shows the 56-byte public key to paste as the constructor argument, then "Attach"). | Decided · Done |
| D-1.39 | **Local dev node** (`tools/devnode.py`, Python only): serves the dApp and a JSON-RPC endpoint on top of the in-memory EVM, with 10 unlocked test EOAs and the verifier pre-deployed. Gives a full local demo with no MetaMask and no testnet. | Decided · Done |
| D-1.40 | ethers **v6.13.4** loaded from jsDelivr (pinned, ES module) through a single file (`js/eth.js`); everything else is project code with no build step. | Decided · Done |

#### Evidence

**Browser self-test** (`apps/web/test.html`, run in the Claude desktop built-in browser, Chromium): **10 of 10 checks pass.**

| Check | Result |
|---|---|
| JavaScript SHA-256 equals Python and WebCrypto at 16 lengths around block boundaries | Pass |
| BIP-39: the 8 official 24-word vectors (entropy → words → seed); a wrong word / checksum is rejected | Pass |
| QRAC key derivation equals the Python reference (4 chain / account / epoch combinations) | Pass |
| LMS H5/W4: public key and 3 signatures byte-identical to Python; modified signature rejected | Pass |
| LMS H10/W4 built in a Web Worker equals Python (tree 2.33 s, signature 1.5 ms) | Pass |
| RFC 8554 Test Case 2 key tree and signature reproduced byte for byte in the browser | Pass |
| Authorization payload, message and rotation payload byte-identical to Python | Pass |

**End-to-end in the dApp** (built-in browser + local dev node, every step through the UI):

| Scenario | Result |
|---|---|
| Create 24 words → connect → build key tree (0.97 s) → deploy account from the dApp → public key verified on-chain → fund 1 ETH | Pass |
| Send 0.25 ETH: PQ-signed, **delivered by a different EOA (relayer)**, confirmed (333,818 gas) | Pass |
| Replay of that authorization → refused, `WrongNonce(1, 0)` | Pass |
| The deployer EOA (treated as compromised) reuses the signature with a payload paying itself → refused (`LeafAlreadyUsed`); balance unchanged | Pass |
| Restricted submitter: refused from the deployer EOA (`SubmitterNotAllowed`), confirmed from the named fresh EOA | Pass |
| A signed-but-unsent send, then a CANCEL for the same nonce: cancel confirmed, the send can no longer land | Pass |
| Rotation to epoch 1 through the UI; the next send uses key #0 of the new tree | Pass |
| ERC-20 batch (transfer 12.5, approve 100, revoke) in one PQ-signed transaction; review decodes each call (335,457 gas) | Pass |
| "New browser" with the words but no journal → signing **locked**; after importing the journal it unlocks at epoch 1, next key #1 | Pass |
| Exported journal (45 KB, 6 entries) contains neither the words nor the seed | Pass |

Python suite after this phase: **46 tests, all passing** (adds BIP-39 official vectors and derivation independence).

#### Not yet verified

- **MetaMask on Sepolia:** not exercised yet. The code path is the standard ethers `BrowserProvider`; it needs a manual run by the team with Sepolia ETH.
- **Automatic journal download** after each signature: implemented; the browser download itself was switched off during automated testing.

#### Files produced

- `apps/web/index.html`, `css/styles.css`, `js/app.js`: the dApp (Setup, Account, Compose & sign, Activity, Manage).
- `apps/web/js/sha256.js`, `lms.js`, `lms-worker.js`, `bip39.js`, `derive.js`, `encoding.js`, `journal.js`, `eth.js`: browser crypto, encoding and signer journal.
- `apps/web/test.html`, `js/selftest.js`, `test/fixtures.json`: browser self-test.
- `apps/web/assets/bip39-english.txt` (official list, SHA-256 `2f5eed53…dbda`), `apps/web/artifacts/*.json`.
- `tools/qrac/derive.py`, `tools/gen_web_fixtures.py`, `tools/build_web_artifacts.py`, `tools/devnode.py`, `tools/tests/test_derive.py`, `tools/vectors/bip39.json`.
- `.claude/launch.json`: preview configurations (static server and dev node).

#### Next

Manual Sepolia run with MetaMask (deploy verifier and account, then send, batch and rotate), record the addresses and transaction hashes under `deployments/11155111/`. Then Phase 2: factory / mint.

### 7 Nov 2026 — Session 1, continued: first Sepolia run, fixes

**General prompt:** the team ran the dApp against Sepolia with Brave Wallet; report and fix what blocked the run, and make seed handling practical for hackathon tooling.

#### Outcome of the run

- The **shared verifier was deployed to Sepolia** from the dApp: `0x64791efC129BA3cc1FD75562Eeefe3fCDb3d3bfC` ([details and checks](../deployments/11155111.md)). Independent checks: the deployed code is byte-identical to the tested build, and an `eth_call` of `verify()` on Sepolia accepts the RFC 8554 Test Case 2 signature and rejects a tampered one.
- The run then stopped: "Connect failed" followed by "Cannot convert null to a BigInt" on key generation.

#### Root cause and fixes

| # | Finding / decision | Status |
|---|---|---|
| F-1 | **Bug:** Brave Wallet exposes `window.ethereum` as a locked Proxy; reading its `on` property throws. The dApp subscribed to wallet events right after connecting, so the error aborted the connection **before the chain ID was stored**. The deploy button still worked (signer already set), but key generation then failed. **Fix:** wallet event subscription is best effort and isolated; the chain ID is stored only when the connection completes, and every action checks it. Reproduced in the test browser with a Proxy built the same way, then verified: connect, key tree, deploy, fund, PQ-signed send all succeed. | Fixed · Verified |
| D-1.41 | **Seed handling made practical (hackathon tooling):** creating a seed no longer asks the user to write words down. It is saved immediately and a **seed file** (`qrac-seed-<fingerprint>.json`, marked SECRET) is downloaded. The Setup tab can download it again and import it back (the 24 words are validated, checksum included). Restoring in another browser needs the seed file **and** the latest journal. Supersedes the "write down the words" step of D-0.4's UX; entropy and format are unchanged. | Decided · Done · Verified (round trip, corrupted file refused) |
| D-1.42 | **Known deployments file:** `apps/web/deployments.json` lists shared contracts per chain; the dApp pre-fills the verifier for the connected chain (Sepolia → the address above). Human-readable records live in `deployments/<chainId>.md`. | Decided · Done |
| D-1.43 | Funding button takes an amount (default 0.02 ETH) instead of a fixed 1 ETH. | Done |
| D-1.44 | **Which local address to use:** `http://localhost:8545` is the dev node (dApp + local chain) and `http://localhost:8080` exists only when `py -m http.server 8080 --directory apps/web` is running. Both serve the **same dApp files**; with a browser wallet either works for Sepolia. On port 8545 the dApp now defaults to "Local dev node" only when no browser wallet is present. | Clarified · Done |

#### Measurement from Sepolia

Contract creation is far more expensive on Sepolia today than on the local Cancun-rules chain: the verifier used **3,978,048 gas** (580k locally), and a `QRACAccount` deployment is estimated at **10.6M gas** (1.54M locally). A full verification as a transaction is estimated at 259,739 gas. This strengthens the case for Phase 2's minimal-proxy factory.

### 7 Nov 2026 — Session 1, continued: Phase 1 proven on Sepolia

**General prompt:** the team completed the Sepolia run (deploy, fund, PQ-signed send) and asked for an independent check, the cause of a failed funding attempt, and the status.

#### Outcome

- **Phase 1 is proven end to end on a public testnet.** Account `0x1465133a13b0DB9f43e674c77291Bb88616f0143` was deployed and funded from the dApp. Then 0.001 ETH left it through `submit()`, authorized only by an **LMS hash-based (post-quantum) signature** with one-time key #0, while the ECDSA wallet merely paid the gas. Independent re-verification from raw chain data with the Python reference: signature valid, tampered copy invalid, nonce and key state updated, recipient credited. Full record: [`deployments/11155111.md`](../deployments/11155111.md).
- **Sepolia gas (authoritative for live-network claims):** account deployment 10,527,434; PQ-signed send 506,958 (vs ~320k on the local Cancun-rules chain). Contract creation is the dominant cost, which Phase 2 (minimal-proxy factory) addresses.

| # | Finding / decision | Status |
|---|---|---|
| F-2 | A 0.069 ETH funding attempt **never reached the chain** (wallet nonce sequence and balance of 0.985 ETH show it was not mined and not underfunded). Brave Wallet failed to broadcast and returned an error ethers could not classify ("could not coalesce error"). The identical code path succeeded with 0.02 ETH a minute later. Not a contract or amount issue. **Fix:** the dApp now shows the wallet's own nested error message for such errors. | Diagnosed · Fixed (message) · Verified |

#### Open question raised by the team

| # | Question | Notes |
|---|---|---|
| O-1.5 | Are the **policy options** (allowed submitter, validity window) needed for a personal account MVP? | The Safe analogy means "the account can do anything the owner wants", not multisig. Both options are already in the contract and tested. The decision is how much of them the dApp should expose. |

#### Decision on O-1.5 (policy options)

| # | Decision | Status |
|---|---|---|
| D-1.45 | QRAC is a **personal** account. The Safe reference means "the account can do whatever its owner wants", not multisig. The submitter restriction and validity window **stay in the contract** (already built and tested, negligible cost). In the dApp they are **hidden under a collapsed "Advanced options"** with defaults **anyone can submit** and **valid for 60 minutes**, so the normal flow is: build action → review → sign → submit. The review screen still shows both values before signing. Closes O-1.5. | Decided · Done · Verified in browser |

### 7 Nov 2026 — Session 1, continued: Phase 2 factory ("mint your account")

**General prompt:** add the presentation's "wow factors", then build the factory so each user mints a minimal account that reuses shared logic.

#### Pitch

- Added an evidence-backed **"Wow factors" section** to [04-PITCH-OUTLINE.md](04-PITCH-OUTLINE.md): nine one-line claims (W1–W9), each linked to evidence and marked ✅ demonstrated or 🔜 planned, a 3-slide short version, and claim guardrails (simulated compromise, "not audited", no "quantum-proof Ethereum").

#### Decisions

| # | Decision | Status |
|---|---|---|
| D-2.1 | **Three layers:** (1) `LMSVerifier`, the signature maths, once per chain (already shared since Phase 1); (2) the **account logic**, one locked `QRACAccount` implementation per chain, created by the factory's constructor; (3) **per user, a 45-byte ERC-1167 minimal proxy** with its own storage and balance that delegates to (2). What Phase 2 stops repeating is the account logic, not the maths. | Decided · Done |
| D-2.2 | **No constructor in minted accounts:** `QRACFactory.mint(publicKey)` creates the clone **and** calls its one-shot `initialize(publicKey)` in the same transaction. No front-running window, and an invalid key reverts the whole mint. | Decided · Done |
| D-2.3 | **`QRACAccount` lifecycle:** constructor with a key = standalone account (Phase 1, unchanged behaviour); constructor with an **empty key = locked implementation** (can never be initialized or used); fresh clone = inactive until initialized. New errors `AccountNotActive`, `AlreadyInitialized`. `initialize` is one-shot, so the account still has no owner or admin path. | Decided · Done |
| D-2.4 | **Deterministic address:** `CREATE2` with `salt = keccak256(publicKey)`. The address is known before minting (it can receive funds first), one address per key, and nobody can mint that address with a different key. Minting is permissionless; the minter gets no rights. | Decided · Done |
| D-2.5 | **No upgrades:** clones point to one fixed implementation forever; the factory has no owner. | Decided · Done |
| D-2.6 | **dApp:** Setup shows the two shared contracts (verifier, factory) with save / deploy; the Account tab shows **"Your account address"** before minting (with its balance) and a **"Mint account"** button. Standalone deployment and Remix moved under "Other ways". The dev node pre-deploys the factory. | Decided · Done |
| D-2.7 | **Known limit:** ETH sent with a 2,300-gas stipend (Solidity `transfer`/`send` from other contracts) may not reach a minted account, because the proxy's delegate call needs more gas. Ordinary wallet transfers and contract calls with normal gas are unaffected. | Recorded |

#### Evidence

`.venv\Scripts\python tools/run_tests.py` → **77 tests, all passing.** The full account behaviour suite now runs twice, once on standalone accounts and once on **minted clones**, plus 7 factory rules:

| Factory rule | Result |
|---|---|
| Implementation is locked: `initialize` → `AlreadyInitialized`, `submit` → `AccountNotActive`, no key installed | Pass |
| Minted code is exactly the 45-byte ERC-1167 proxy, and the address equals an **independent CREATE2 computation** in Python and `predictAddress()` | Pass |
| One address per key: minting the same key again → `AlreadyMinted` | Pass |
| A stranger can mint (and pay) for your key but gets no rights: re-initialize refused, fake signature refused; the key holder spends | Pass |
| Funds sent to the predicted address **before** minting are spendable after minting | Pass |
| Two minted accounts are independent (state, balances, signatures not transferable) | Pass |
| `AccountMinted` event emitted with the key fingerprint | Pass |
| Mint with an invalid key reverts and leaves no code at the predicted address | Pass |

**dApp end to end (built-in browser + dev node):** create seed → connect → key tree → the predicted address is shown before it exists → 0.1 ETH sent to it in advance → **Mint** (167,575 gas) → auto-attach, balance 0.1 ETH already there → PQ-signed send of 0.03 ETH delivered by a relayer EOA (350,198 gas), encoding identical to the contract's.

#### Measurements (local chain, Cancun rules, LMS H10/W4, total transaction gas)

| | Standalone (Phase 1) | Minted (Phase 2) |
|---|---|---|
| Create one user account | 1,614,252 | **167,575** (≈ 9.6× cheaper) |
| One-time shared setup | none | factory + implementation 1,814,349 |
| Send ETH / ERC-20 / 5-call batch / cancel / rotate | 346k / 339k / 353k / 283k / 326k | 332k / 325k / 339k / 295k / 329k |

Per-action costs are within the run-to-run variation of the signature check (fresh random keys each run); the proxy hop costs a few thousand gas. **Sepolia figures pending** (factory not deployed there yet); on Sepolia a standalone account cost 10.5M gas.

#### Files

- `contracts/QRACFactory.sol` (new), `contracts/QRACAccount.sol` (clone-ready).
- `tools/tests/test_account_evm.py` (clone variants, `FactoryRules`, gas report), `tools/devnode.py`, `tools/build_web_artifacts.py`.
- `apps/web/index.html`, `apps/web/js/app.js`, `apps/web/artifacts/QRACFactory.json`.

#### Next

Team: on Sepolia, Setup → "Deploy factory" (one time), then mint an account and send. Record the factory address in `apps/web/deployments.json` and `deployments/11155111.md`, and the Sepolia mint gas in the pitch (W9). Then Phase 3.
