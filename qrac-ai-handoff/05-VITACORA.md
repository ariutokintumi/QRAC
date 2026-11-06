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
| O-1.1 | Final LMS parameters (tree height, Winternitz `w`) for the demo. | Trade-off: browser key-generation time vs. verification gas vs. signature size. Measure before fixing. |
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
