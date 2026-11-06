# Release acceptance and Safe capability comparison

Single-release scope, confirmed 6 November 2026. Everything below is a requirement or proposal, not completed functionality. Safe comparison means a capability reference; it does not imply a Safe fork, ABI compatibility, service support or inherited audit coverage.

## Included in the proof of concept

| Capability | Required account behavior | Required dApp/demo behavior |
|---|---|---|
| Account creation | Fixed shared implementation; independent clone state/assets; atomic factory initialization. | Create from new PQ identity, show/verify account configuration, fund test account. |
| PQ ownership | One current PQ authority; no ECDSA spend/reset/upgrade bypass. | 24-word independent mnemonic; account remains usable with another submission EOA. |
| Native funds | Receive native currency; execute signed value transfers. | Balance, receive address and send form. |
| ERC-20 | Signed transfer, approve and revoke paths; explicit handling of supported return conventions. | Manual token import, balances, recipient/spender/amount review and accurate outcomes. |
| ERC-721 / ERC-1155 | Standard receive callbacks; signed transfer calls. | Minimal manual transfer/raw-call support and demo fixtures; no gallery requirement. |
| Contract interaction | Ordinary CALL to target; target sees account as caller. | Raw transaction builder and one named protocol integration, tested on a fork or real test deployment. |
| Atomic batch | Ordered, fully authorized CALLs; all-or-nothing when a required call fails. | Add/reorder calls before signing; display order/value/data and outcome. |
| Replay defense | Chain/account/epoch/action nonce binding and consumed-key checks. | Clear nonce and pending/replaced/cancelled statuses. |
| Replacement / cancellation | Fresh OTS authorization, no duplicated action-nonce success. | Explain that cancellation is effective only when executed; replacement does not immediately revoke a prior instruction. |
| Root renewal | Authenticated new configuration/epoch; old epoch invalidated; global nonce never reset. | Remaining local signing capacity, reserve enforcement and working renewal. |
| Submission policy | Open mode or signed allowed immediate caller. | Switch submission EOA, export exact authorization, show restricted rejection/success. Fresh-EOA pattern demonstrated without permanent owner association. |
| Signing state | Not an on-chain feature: client must prevent generation reuse. | Persist reservations before signing; exact retry; current-state export/resume; no seed-only assumption of safe signing. |
| Basic history | Account events and receipts support state reconstruction. | Track drafts/signed/unsubmitted/pending/confirmed/reverted/expired/invalidated states; no hosted indexer required. |

## Explicitly excluded from this release

| Safe or broader wallet capability | Scope decision and reason |
|---|---|
| M-of-N owners and threshold changes | Single PQ authority is sufficient to prove the concept; no multisig parity claim. |
| Arbitrary DELEGATECALL | Can modify account storage/authority; user-selected delegatecall excluded. Fixed clone delegation to its implementation is different. |
| Modules and automated execution | Avoid additional spend-authority routes outside the PQ check. |
| Installable guards / general fallback handlers | Use fixed account functions and narrowly defined token receiver callbacks. |
| Generic ERC-1271 / off-chain order signing | Read-only validation cannot itself consume an authorization; separate purpose/lifetime/replay design is not part of this release. |
| approveHash and arbitrary message approvals | No EOA shortcut or extra signature acceptance mechanism. |
| Account-funded gas refunds / token fees | Gas payer pays directly; no signed-refund subsystem required. |
| ERC-4337 / bundlers / paymasters | Ordinary EOA transactions suffice for the demonstration. |
| Full Safe UI, Apps, Transaction Service or wallet-provider integration | Custom account does not automatically integrate with these services; use a focused project dApp. |
| Complete asset discovery, pricing and NFT galleries | Manual asset entry and on-chain balances are sufficient. |
| Social recovery / guardians / general OPSEC product | Outside the user's chosen scope. Safe signing-state handling remains mandatory. |
| Privacy protocol / anti-MEV guarantee / mainnet production deployment | Not established by this design or needed for the proof. |

Safe's contracts, frontend and Transaction Service are different layers. Useful transfer/batch functions do not equal complete Safe functionality. The comparison uses [Safe's account overview](https://docs.safe.global/advanced/smart-account-overview), [pinned v1.4.1 contract source](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/Safe.sol), [MultiSendCallOnly](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/libraries/MultiSendCallOnly.sol), [modules](https://docs.safe.global/advanced/smart-account-modules), [fallback handlers](https://docs.safe.global/advanced/smart-account-fallback-handler), and [Transaction Service](https://docs.safe.global/core-api/transaction-service-overview). v1.4.1 is a reproducible reference, not a claim about the latest Safe version.

## Acceptance groups

Keep a checklist with test names, command, result and relevant commit. At package creation, every group is **NOT IMPLEMENTED / NOT TESTED**.

### A1 — Cryptographic conformance

- Standard valid vectors and independently generated messages verify both off-chain and on-chain.
- Wrong message, secret-derived signature element, authentication path, public key, tree ID, parameter ID, index and length reject.
- Boundary/malformed inputs cannot induce uncontrolled loops, memory growth or accidental acceptance.
- No unsupported weaker parameter set is accepted through the account's public interface.
- Cross-language encoding fixtures match byte-for-byte, including empty, multiple and variable-length call data.

### A2 — Exact intent binding

For a valid authorization, independently mutate account, chain, epoch, action nonce, leaf index, action kind, target, value, calldata, call ordering, submitter, validity window and return/failure policy. Every changed authorized field must invalidate the signature or fail an explicit bound.

Bind full renewal configuration, not just a root node. Any later fee field must receive the same mutation tests; this release should have none.

### A3 — Authority and factory isolation

- Deployer, factory, implementation and arbitrary caller cannot spend, renew, reset or change account logic without PQ authorization.
- Standalone implementation initialization is locked; clone initialization is one-shot; failed initialization cannot leave a claimable account.
- Two accounts retain independent roots, nonces, key state and balances.
- If CREATE2 is used, altered initialization configuration cannot initialize the intended predicted address. Copying identical creation inputs cannot substitute authority.
- Unknown selectors, callbacks and direct implementation calls cannot access an alternate execution route.

### A4 — Replay and competing authorizations

- A successful instruction cannot execute twice; same nonce candidates cannot both succeed.
- Cross-account, cross-chain and stale-epoch reuse fail.
- On-chain consumed-leaf state prevents accepting a leaf again under its epoch.
- Cancellation consumes the specified nonce only after valid execution. A race with an earlier valid instruction behaves as documented.
- Expired/not-yet-valid operations reject; merely deleting a local draft does not claim on-chain cancellation.

### A5 — Failed execution and reentrancy

- Reverting target/batch member, insufficient account funds, excessive return data, outer out-of-gas and callback attempts cannot bypass authorization.
- Atomic failure leaves account/target state rolled back as specified; reverted events are not used as persistent evidence.
- Signer state still treats the attempted leaf as unavailable for another message.
- Exact cached retry can succeed while valid; a changed replacement uses a fresh leaf and can succeed at the same action nonce.
- Reentrant spend, root rotation and nonce invalidation are blocked. No unsigned simulation helper can execute a real state change.

### A6 — Signing lifecycle and restoration

- Concurrent tabs/requests cannot allocate the same leaf for different messages.
- Journal reservation precedes signature generation; crash/ambiguous attempts never automatically release that leaf.
- Editing, simulating, fee replacement, account reload and receipt handling do not cause unsafe generation reuse.
- Signer counts unsubmitted/reverted operations toward consumed signing capacity.
- Chain reorg handling does not roll local allocation state backward.
- Seed-only import cannot silently infer signing safety from chain state. Current-state bundle resume works; undocumented stale-state recovery is not claimed.

### A7 — Renewal and finite capacity

- Current PQ authority authenticates full next configuration; epoch increases; action nonce remains monotonic.
- Old-epoch signatures reject after rotation.
- Exactly reused verification material is rejected even with a new account epoch; comparison excludes the epoch itself.
- Client derivation ensures fresh key material across accounts/chains/trees.
- Ordinary signing stops before reserved renewal capacity; tests demonstrate rollover near exhaustion.
- Exhausting all safe keys is reported as a terminal capacity problem under this scoped model, not silently “recovered” through ECDSA or reuse.

### A8 — Open, restricted and disposable submission

- Open mode accepts the same valid operation from an unrelated payer without granting that payer general ownership.
- Restricted mode rejects a different immediate caller; allowed address succeeds.
- Changing the permitted EOA requires a fresh PQ authorization.
- Demonstrate operation through a fresh funded EOA, then another operation through a different EOA with no owner-reassignment transaction.
- Give a test attacker the deployment EOA's private key; valid ECDSA outer transactions carrying spending/configuration attempts without valid PQ authorization fail at the account check.
- Give it the allowed submitter's key: it may deliver an already valid bound instruction, but cannot change that instruction. Record this limit explicitly; do not assert anti-sandwich protection.

### A9 — Assets and real protocol calls

- Native and ERC-20 sends, approvals and revocation work and show expected state changes.
- Test supported standard/false-return/no-return token cases under the selected return policy. Generic CALL success is not misreported as application-level success.
- ERC-721/ERC-1155 receive/send callbacks work without spending authority.
- Complete one named existing protocol operation through the account; record chain/fork block, addresses and observed account ownership. Label mocks separately.
- Document external allowances/administrator behavior as remaining protocol permissions, not bypasses secretly repaired by the account.

### A10 — dApp consistency and usability

- Displayed transaction review matches exactly the bytes signed and executed.
- Mnemonic uses 24 words and the agreed entropy; generation, deployment and configuration verification complete end-to-end.
- Switching submission EOA never switches the PQ identity or signing state accidentally.
- Root progress/capacity, pending/reverted/expired/replaced outcomes, cancellation and renewal remain understandable.
- Exported authorization can be delivered unchanged by the designated submission route.
- Unsupported controls/features are absent or clearly unavailable, never fabricated as completed.

### A11 — Measured feasibility and reproducibility

- Record versions, algorithm parameters, calldata size, code size and limits; benchmark deployment, verify, execute, batch, cancel and renew.
- Distinguish execution gas from full transaction cost and chain data fees.
- Record browser generation/signing latency and memory with environment details.
- Verify deployed code against the build, publish address/configuration manifest and testnet evidence.
- Clean-checkout commands reproduce tests, local app and scripted demo without private setup knowledge.

### A12 — Pitch integrity

- Every “solved” claim maps to an acceptance group and actual evidence.
- Simulated ECDSA compromise is labeled a simulation, not quantum hardware execution.
- No claim of full privacy, solved MEV, all-protocol compatibility, full Safe parity, forward secrecy, production audit or unmeasured gas appears.
- State what is demonstrated, what remains a design assumption, and what was excluded.

## Release sign-off record

Use a table containing: acceptance group; status; test/artifact link; source commit; date; limitations. Record “blocked” or “not tested” when evidence is absent. The release is complete only when all included groups pass and the demo is reproducible; a polished UI or pitch alone is insufficient.
