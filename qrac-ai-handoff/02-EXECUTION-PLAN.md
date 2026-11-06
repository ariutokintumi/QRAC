# Execution plan — one complete proof-of-concept release

This is an ordered implementation plan for the next AI instance. It is not a multi-release roadmap. Work packages below all contribute to the same release. Nothing listed as implemented has been implemented yet.

## Completion target

From a clean checkout, a reviewer can run tests, start the dApp, generate a new 24-word PQ identity, deploy an account, receive and manage test assets, execute single/batched calls, choose an allowed submitter, renew a key tree, and reproduce rejection of unauthorized, modified, replayed, or stale operations. A disclosed original EOA key is insufficient to spend from the account. A named testnet demonstration and reproducible local setup support the pitch.

## Suggested workspace

```text
contracts/                  verifier, account implementation, factory, token receivers
contracts/test/             unit, adversarial, invariant and integration tests
packages/authorization/     exact encoding, decoding and shared test fixtures
packages/pq-signer/         reference-compatible signer, derivation and journal
apps/web/                   account creation and management dApp
scripts/                    local setup, deployment, benchmark and demo commands
deployments/<chain-id>/     addresses, configuration, source commit and receipts
docs/                       architecture decisions, security model, operations and demo
artifacts/                  measured results, test reports and final pitch assets
```

Suggested tools: Solidity with Foundry for contracts/testing; TypeScript for the SDK and a small React-based browser application; a browser worker for expensive tree/signature generation; standard EVM RPC/wallet libraries. These are defaults, not locked versions. Inspect the environment, check official documentation, pin compatible versions, and record licenses before adopting dependencies. Prefer a credible existing reference-compatible crypto implementation; do not introduce a large service backend solely to manage a single-user demo.

## W0 — Establish the working specification

**Depends on:** reading the handoff.

1. Inspect the actual repository/environment and preserve existing user work. Record what exists and what is missing.
2. Create a concise decision record containing confirmed constraints, one-release inclusion/exclusion list, and the evidence status.
3. Define benchmark measurements and select the testnet candidate. Recheck chain transaction-size/gas limits and compiler EVM target.
4. Create the initial repository structure, pinned toolchain, test commands, and an example configuration containing no real secrets.

**Deliverables:** runnable project skeleton, `docs/DECISIONS.md`, exact local setup command, initial scope checklist.

**Exit:** another developer can install/build the empty project; no unresolved product decision is being disguised as a technical default.

## W1 — Validate the cryptographic choice before building the wallet around it

**Depends on:** W0.

1. Compare available reference-compatible implementations and their licenses. Start with the LMS/LM-OTS candidate in the brief, not an ad hoc Lamport variant.
2. Generate or ingest standard vectors, including invalid cases. Validate exact serialization, parameter identifiers, randomizer use, tree identity, authentication path and message handling.
3. Measure browser key-tree generation, signing time, memory footprint and serialized signature size. Use a worker and progress reporting for expensive generation.
4. Specify independent 256-bit entropy, 24-word generation, mnemonic conversion, wallet identifier, chain/tree namespaces, and scheme-compatible seed/leaf derivation.
5. Specify full canonical authorization bytes and action variants, including the exact representation of token-return rules. Choose between a signed per-call return rule and a narrowly typed token action now; both signer and verifier/account must agree before parallel work starts. Avoid a premature generic digest/EIP-712 adapter. Freeze encoding fixtures shared by signer and Solidity only after this choice.
6. Choose tree capacity and renewal reserve from measurements. Document the security target without deriving it solely from seed length.

**Deliverables:** cryptographic decision record, reference signer/verifier, fixtures, derivation specification, preliminary performance report.

**Exit:** signatures verify with an independent reference; altered messages fail; the candidate is practical enough for the demo. If not, report the measured blocker and select another defined parameter set or construction explicitly. Do not quietly weaken parameters or substitute hashes.

## W2 — Implement and benchmark the on-chain verifier

**Depends on:** W1's algorithm and encoding fixtures.

1. Implement a bounded verifier for the selected public-key/signature formats. Reject unsupported algorithm IDs and malformed lengths rather than trying to be universally algorithm-agile.
2. Use the chain's existing hashing facilities. Bound loops, index/path lengths and memory allocation; handle precompile failures explicitly if applicable.
3. Run differential tests against the reference implementation, known-answer vectors, mutated proofs, boundary indices and malformed input.
4. Measure bytecode size, verification gas and full transaction data costs. Separate mathematical-verification gas from account execution and total fees.
5. Select fixed standalone verification versus inlining based on real code-size/cost results. The verifier has no mutable owner-controlled acceptance policy.

**Deliverables:** verifier contract, differential tests, reproducible benchmark command, recorded format limits.

**Exit:** correct and invalid vectors behave as specified; it fits the named target's constraints with measured results. Mock-verifier tests do not satisfy this gate.

## W3 — Implement account, factory and transaction state machine

**Depends on:** W1's wire specification; final integration depends on W2.

1. Implement one current verification configuration, root epoch, monotonic action nonce, consumed-key state, past-key fingerprints and guarded initialization.
2. Implement `EXECUTE`, `ROTATE_ROOT`, and `CANCEL_CURRENT_NONCE` with one coherent PQ authorization policy.
3. Add open/restricted direct-submitter modes and signed validity windows. Use msg.sender only for the immediate submission restriction.
4. Implement ordinary CALLs and all-or-nothing ordered batches. Update account state before external interactions; revert all changes on required-call failure; prevent reentrancy. Disallow generic CALL-to-self in the first version unless a reviewed need establishes safe semantics; use dedicated management actions instead.
5. Implement the token-return representation frozen in W1. It must reject `false` and invalid return data while permitting the supported no-return token convention. Bind the chosen rule to authorization; opaque raw calls retain opaque outcome semantics. A necessary schema change requires a versioned update and regenerated cross-language fixtures before dependent work continues.
6. Add native receive support and direct ERC-721/ERC-1155 receiver callbacks. These callbacks must not confer execution authority.
7. Build the fixed implementation and factory. Create and initialize clones in one transaction. Lock implementation initialization and reject repeated clone initialization.
8. If deterministic deployment is used, derive identity from the complete initialization configuration and a user wallet/salt domain. Test copying public deployment inputs and conflicting roots. Avoid the root/address derivation cycle.
9. Specify events/errors. Reverted transactions discard logs; activity must use transaction receipts and retained local state for failures.

**Deliverables:** account/factory contracts, ABI, deployment script, threat-model tests and documented state transitions.

**Exit:** only PQ-authorized transitions can spend/change authority; one clone cannot affect another; no deployer or factory privilege remains. Actual verifier integration passes, not just mocked authorization.

## W4 — Build the signer SDK and durable signing state

**Depends on:** W1's cryptographic and encoding specification; can overlap W2/W3 after interfaces stabilize.

1. Separate editable drafts from frozen authorizations. Editing must not consume a key until signing starts.
2. Allocate and persist a leaf reservation before generation; use single-writer locking for the same identity, including multiple browser tabs. A crashed/uncertain allocation is never automatically reused.
3. Store the exact authorized bytes/signature, account/chain/tree metadata, nonce and submission policy. Expose exact retransmission without fresh signing.
4. Implement fresh-leaf replacement, authenticated cancellation, expiry checks and renewal-reserve enforcement.
5. Export a versioned signer-state bundle; support resuming with a trustworthy current bundle. Seed-only restoration cannot discover unpublished signatures and must not automatically resume signing. Do not promise that arbitrary stale state can be detected or recovered.
6. Ensure simulation, nonce reads, reloads, receipt failure and reorg handling never roll local signing state backward. Reconcile chain state separately; do not assume an observed receipt is permanently final.
7. Namespace derivation across accounts/chains/trees; never use the same raw OTS key for different contexts.

**Deliverables:** documented SDK, signing journal schema/migrations, crash/resume tests, export/resume flow, sample fixtures using test secrets only.

**Exit:** repeated execution attempts cannot cause a leaf to sign a second message; failed/unsubmitted attempts remain accounted for; root exhaustion is visible before normal signing reaches reserved capacity.

## W5 — Build the focused dApp

**Depends on:** W3/W4 interfaces. Layout work may begin earlier with clearly marked fixtures.

Build the seven flows in the brief: Create, Account, Compose, Review, Authorize, Activity, Manage. Required details:

- 24-word generation and existing-state import; tree progress; atomic account creation; verified deployed configuration.
- Native/ERC-20 balances and manual token import. NFT receive/send support through minimal forms or raw calls; a gallery is unnecessary.
- Native/token sends, approval/revocation, raw contract call and an ordered batch builder.
- Exact intent review, chain/account identity, nonce/epoch, time constraints and allowed submitter. Unknown calldata is shown as raw data, not mislabeled as a decoded safe action.
- Connect a gas-paying wallet independently from the PQ identity. Allow different submission wallets and export/import of the exact signed payload. Demonstrate one fresh EOA; automatic fresh-EOA provisioning/funding is not required.
- Simulation before signing where feasible, without adding any unsigned state-changing account route. Estimating a fully signed transaction may use the already cached signature; it must not regenerate a different signature or intent.
- Distinct pending, reverted, expired and superseded states. A mined receipt alone is not evidence that every arbitrary protocol call achieved its business objective.
- Root renewal, current-nonce cancellation, remaining local key capacity, and state export/resume.

**Deliverables:** runnable browser app, fixture/demo mode clearly labeled, end-to-end tests for key journeys.

**Exit:** the complete create → fund → authorize → submit → inspect loop works with real contracts on the local deployment. The UI never needs the original deployment EOA as an account owner.

## W6 — Integrate and attack the implementation

**Depends on:** W2–W5.

Run every acceptance group in document 03. Include tests of the actual client-generated authorizations against real verifier/account bytecode, rather than relying solely on either side's own fixtures.

Use a local fork or a maintained test deployment of a named existing protocol. Execute a meaningful account-owned position or operation with ordinary calls. A mock protocol is useful for adversarial testing but cannot support a claim of actual external integration. If an existing protocol is unavailable, report that integration gate as incomplete instead of substituting an unlabeled mock.

Demonstrate a failed atomic operation followed by a revised authorization using a fresh leaf and the same action nonce. Demonstrate cancellation and replacement races without suggesting off-chain deletion invalidates an exposed authorization. Test old-root rejection after renewal and independent state across two accounts.

**Deliverables:** complete test report, issue register with resolutions, integration fixtures and commands.

**Exit:** no unresolved defect violates the declared authorization model. Unsupported behavior is excluded explicitly, not left as a working UI control.

## W7 — Testnet deployment and measurement

**Depends on:** W6 passing; use test assets.

1. Deploy fixed verifier/implementation/factory and at least two sample accounts to the chosen testnet. Record chain ID, versions, configuration, addresses, transaction hashes and source commit.
2. Publish/verify source where supported and validate that deployed code/configuration matches the tested build. Deployment-wallet access is not evidence of account ownership.
3. Measure creation costs, verification-only gas, full single/batch transaction gas, calldata bytes, renewal/cancellation costs and client timings. Include chain fee components and the exact algorithm/parameters. Do not reuse Gemini's gas estimate.
4. Test Ethereum execution compatibility locally and distinguish this evidence from mainnet deployment. Additional networks are optional evidence only if actually tested; do not broaden release scope into a deployment campaign.

**Deliverables:** deployment manifest, benchmark tables with reproducible commands and environment, explorer links, known limitations.

**Exit:** deployed behavior matches local tests and fits the named network's limits. Mainnet spending or real assets require a separate explicit user instruction; they are unnecessary for this proof.

## W8 — Package the demo and pitch

**Depends on:** W6/W7 evidence.

Use document 04 to produce the actual presentation only when requested or when execution scope explicitly includes it. Update all capability labels from designed to demonstrated only where supported. Include real measurements instead of illustrative numbers.

Prepare a deterministic demo with public test secrets where useful: create/fund an account; disclose its deployment EOA key to an attacker; submit valid ECDSA outer transactions from that compromised EOA without valid PQ authorization and demonstrate rejection by the account; submit a legitimate PQ action from another EOA; reject modification/replay; demonstrate restricted submission, failed-action replacement and root renewal. Explain that disclosure models ECDSA compromise; no quantum hardware is being demonstrated.

**Deliverables:** clean README, quick-start, scripts, source/tests, deployment manifest, benchmark report, demo instructions/recording, completed capability checklist, and pitch copy linked to evidence.

**Exit:** a new person or AI can reproduce the proof without the original chat or undocumented manual steps.

## Dependency and collaboration guide

Critical path: W0 → W1 → W2/W3/W4 → W5 → W6 → W7 → W8. W2 verifier implementation, W3 account/factory work, and W4 signer state work can run in parallel only after the shared encoding and cryptographic interfaces are frozen. Separate agents should own separate directories and review the shared fixtures together. Do not let parallel implementations invent incompatible authorization formats.

## Execution rules for the next AI

- Keep an honest implementation status and decision log; distinguish measured facts from assumptions.
- Ask the user only if changing the chosen threat model, crypto family, first-release scope, or deployment spending. Routine engineering choices can be made and recorded.
- Do not stop at a design sketch: continue through reproducible code, tests, dApp and demonstration within available tooling.
- If an external dependency blocks deployment, finish local implementation and report the exact remaining dependency; do not mark the deployment complete.
- Do not introduce ECDSA escape hatches, pretend OTS state is optional, or claim that sender restriction solves MEV.
- Exclusions are final boundaries of this requested release, not an automatic future roadmap.
