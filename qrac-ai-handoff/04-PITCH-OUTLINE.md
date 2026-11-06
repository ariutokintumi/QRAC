# QRAC — pitch outline and claim boundaries

Prepared 6 November 2026. QRAC is a working name, not a finalized brand. This document is a script and slide-content proposal, not a rendered slide deck.

## Current evidence status

The project is at architecture and planning stage. No account, verifier, signer, factory, or dApp has been implemented or benchmarked in this conversation. Every mechanism below is a design response awaiting implementation and validation. The user confirmed a **24-word / 256-bit seed** and **one focused first release sufficient to prove the concept**, without a full-Safe-parity commitment or a multi-release roadmap. In presentation drafts, mark capabilities as **designed**, **prototype-demonstrated**, or **validated** according to the evidence actually available at presentation time. Do not use hypothetical benchmark numbers, imply an audit, or claim a quantum computer was used in the demo.

The pitch should lead with this scoped claim:

> A personal contract account that requires post-quantum authorization before moving assets or calling existing applications, without waiting for an EVM protocol upgrade.

The precise security claim is: under trustworthy enrollment, an uncompromised PQ secret, correctly implemented cryptography and account logic, and continued correct chain execution, compromise of the original ECDSA key alone does not authorize actions from the separate contract account. External protocols retain their own security assumptions.

## Suggested 12-slide narrative

### 1. Your transaction key should not be your account's only authority

**On-slide copy**

- QRAC
- Post-quantum authorization. Existing EVM applications.
- The transaction submitter delivers an instruction; the account verifies who authorized it.

**Visual:** Three simple boxes: PQ signer → signed instruction → contract account → application. A separate gas payer delivers the instruction to the account.

**Speaker notes:** We separate the key that authorizes an action from the EOA that pays to place it on-chain. An ECDSA transaction still reaches the network, but it is insufficient to control the protected account.

**Evidence needed:** Deployed contract/account addresses and a working action before presenting this as a live product. Until then, label the graphic “Proposed architecture.”

### 2. The problem: account authorization depends on vulnerable signatures

**On-slide copy**

- Standard Ethereum EOAs authorize transactions with ECDSA.
- A sufficiently capable quantum attacker could forge that authority.
- Application accounts can adopt different authorization logic today.

**Visual:** Two layers: outer network transaction and inner account authorization. Highlight that the project changes the inner check.

**Speaker notes:** Do not claim that practical quantum theft is happening today or give an unsupported arrival date. We are preparing the authorization layer while recognizing that consensus and other infrastructure also need migration.

**Evidence/source:** [Ethereum quantum-resistance overview](https://ethereum.org/roadmap/security/quantum-resistance/). No invented forecasts or market-loss figures.

### 3. The architectural pivot: put the check in the account

**On-slide copy**

- Original concept: every protocol integrates a QR signature guard.
- Revised design: each user deploys an account that checks authorization before calling protocols.
- Many existing contract-compatible applications need no custom QRAC integration.

**Visual:** Before/after diagrams: many protocol integration arrows versus one account boundary.

**Speaker notes:** This is the product insight, not a claim of inventing hash-based cryptography or smart accounts. Account custody and protocol positions move to the contract address. EOA-only applications and ECDSA-only signature flows remain compatibility exceptions.

**Evidence needed:** At least one ordinary token transfer and one interaction with an existing protocol or representative fork/test deployment. Name precisely what was tested.

### 4. What the account trusts

**On-slide copy**

- A PQ public-key commitment installed during trustworthy enrollment.
- An exact signed action: account, chain, target, value, call data, and constraints.
- Replay protection and a defined key lifecycle.
- No ECDSA administrator bypass.

**Visual:** Signed instruction card with fields, next to the account's stored root and nonce.

**Speaker notes:** The account does not use tx.origin to infer its owner. The original deployment wallet has no continuing special right to spend, reset the key, or upgrade away the check. This must remain true across every execution and management path.

**Evidence needed:** Tampered recipient, wrong-chain, wrong-account, stale-nonce, and owner-bypass tests.

### 5. One-time keys that survive failed transactions

**On-slide copy**

- One root commits to a collection of independent signing keys.
- Each key signs one message; a Merkle proof connects it to the account.
- A failed action can be replaced using a fresh key.
- Signing-key indices and action nonces serve different purposes.

**Visual:** Small Merkle tree with key A marked “signed, action failed” and key B signing a revised action for the same action nonce. Show the first successful authorized execution consuming that nonce.

**Speaker notes:** A reverted transaction does not make an exposed one-time key safe for another message. The client records signing attempts, not only successful receipts. A published original authorization is still live until it expires or is invalidated. The exact standard and parameters must be selected and benchmarked before claiming a completed implementation.

**Evidence/source:** [LMS specification](https://www.rfc-editor.org/rfc/rfc8554.html), [state-management guidance](https://www.rfc-editor.org/rfc/rfc10033.html). Demo a failure, fresh-key replacement, and rejection of the superseded instruction after nonce consumption.

### 6. PROBLEMS SOLVED

**On-slide copy**

| Problem | Design response |
|---|---|
| Original EOA key compromised | Independent PQ authority in a separate account |
| Protocol-by-protocol adoption | Account verifies before ordinary protocol calls |
| Copied instruction modified or replayed | Exact action binding, domain separation, nonce/key checks |
| Single-key rotation blocked by failure | Precommitted independent signing keys |
| Unwanted third-party submission | Optional signed allowed-submitter restriction |
| Repeated full-code deployment | Small accounts sharing a fixed implementation |

**Visual:** Six compact rows; attach small “design” or “demonstrated” status markers.

**Speaker notes:** The submitter restriction is a scoped permission control, not a solution to all front-running, MEV, or quantum impersonation. The phrase “solved” must be backed by the narrower definitions below.

**Evidence needed:** Link each row to a demonstration or test result. Do not silently convert the planning matrix into implementation claims.

### 7. Choose who delivers the instruction

**On-slide copy**

- Open mode: any EOA can submit a valid instruction.
- Restricted mode: the PQ signature names an allowed submitter.
- A fresh EOA can be used for individual submissions.
- The EOA has delivery permission, not general account ownership.

**Visual:** One signer, two submission routes: arbitrary relayer and designated EOA. A separate caption says “Account activity remains public.”

**Speaker notes:** Check the immediate caller in the direct-submission design. A designated EOA can still submit early and can still be sandwiched. An attacker who quantum-breaks that EOA can impersonate it. Fresh addresses do not guarantee secrecy or unlinkability; funding and transactions can link them. The useful distinction is eliminating a mandatory permanent owner EOA.

**Evidence needed:** Open-mode success from an unrelated EOA, restricted-mode rejection from another address, and success from the allowed address. Do not demonstrate this as universal MEV prevention.

### 8. A familiar account experience

**On-slide copy**

- Create an account; back up the independent 24-word PQ seed.
- Receive assets, send, approve, and batch application calls.
- Inspect exact transaction intent before authorizing.
- Review pending and completed operations; manage keys and policy.

**Visual:** Four interface screens: create → portfolio → review → activity. Mark mockups as mockups until built.

**Speaker notes:** Safe is the functional reference, not a claim of Safe implementation or feature parity. The user selected one focused proof-of-concept release. A capability matrix distinguishes the essential account functions selected for this release from Safe features outside its scope; it is not a promise of later releases. The mnemonic represents 256 bits of independent seed entropy. Mention threshold signing, modules, contract signatures, and recovery only if explicitly included and demonstrated.

**Evidence needed:** A real end-to-end user flow and an honest feature-status checklist.

### 9. Deploy small accounts from a factory

**On-slide copy**

- One fixed account implementation.
- A factory deploys and initializes each user's minimal account atomically.
- Each account retains separate assets, keys, and replay state.
- Verification logic is reused; ownership is not shared.

**Visual:** Factory → three small accounts → fixed implementation. Draw each account's distinct storage below it.

**Speaker notes:** ERC-1167 minimal proxies provide the reference model. A clone does not run the implementation's constructor for every user; the factory initializes the account in its creation transaction. This is not an upgradeable shared-admin system. Never imply that small deployment bytecode makes PQ verification free.

**Evidence/source:** [ERC-1167](https://eips.ethereum.org/EIPS/eip-1167). Show measured deployment and execution gas with compiler, chain, algorithm, and transaction-size context once available.

### 10. Demo: the old EOA key is no longer enough

**On-slide copy**

1. Deploy and fund an account.
2. Give the attacker the original EOA key.
3. Reject unauthorized spending and a modified instruction.
4. Execute a legitimate PQ-authorized action through another submitter.
5. Reject replay; demonstrate fresh-key handling after a failed action.

**Visual:** Split “attacker attempt / authorized execution” timeline with transaction results.

**Speaker notes:** Explicitly label this a simulated ECDSA compromise. Possession of the stolen ECDSA key models the relevant authority a quantum attacker could obtain; it is not a quantum-computing demonstration. Submit valid ECDSA network transactions from that EOA and show that the account rejects them without PQ authorization, rather than merely demonstrating invalid outer transactions. Scope the final failure example to the selected execution semantics.

**Evidence needed:** Reproducible demo script, transaction hashes where deployed, receipts, and relevant test output. Keep a recorded fallback.

### 11. What the prototype proves—and what it does not

**On-slide copy**

| Evidence we will report | Boundaries we retain |
|---|---|
| Verified signatures and rejected mutations | No claim of upgrading chain consensus |
| Replay and one-time-key lifecycle tests | No complete privacy or MEV guarantee |
| Working calls to named applications | No universal application compatibility |
| Measured deployment/verification costs | No unmeasured gas claims |
| Explicit Safe capability matrix | No implied complete Safe parity |

**Visual:** Evidence dashboard with real numbers/status only.

**Speaker notes:** This is a focused security primitive and account experience. Operational security, device compromise, and social recovery product design are outside the current requested threat model. Correct OTS state management remains inside it because it affects signature security directly.

### 12. One release, a concrete proof

**On-slide copy**

- Complete the verifier, account, factory, signer, and transaction UI.
- Validate adversarial cases and benchmark actual costs.
- Demonstrate on a named testnet; assess wider network compatibility without claiming untested deployments.
- Prove that account control survives disclosure of the original EOA key.

**Visual:** Four release acceptance criteria with completed/in-progress/planned status, updated before presenting. This is a proof checklist, not a multi-release roadmap.

**Speaker notes:** Finish with the action appropriate to the event: request feedback, integration partners, or cryptographic review. Do not invent partnerships, audits, adoption, or funding. The ask should reflect the project's actual stage.

## Shorter presentation variants

- **Three minutes:** Slides 1, 2, 3, 5, 6, 10, 12. Put compatibility and claim boundaries in speaker notes and appendix.
- **Five minutes:** All slides, roughly 15–25 seconds each, with the longest segment reserved for the demo.
- **Technical appendix:** Algorithm/parameter justification; exact signed-action schema; signer state machine; failure and cancellation semantics; Safe feature matrix; benchmark methodology; EOA restriction limits; contract and source links.

## Expanded problem/solution claim register

| ID | Problem addressed | Scoped pitch claim | What remains outside the claim |
|---|---|---|---|
| P1 | ECDSA forgery after enrollment | The account requires independent PQ authorization even if the original EOA key is compromised. | PQ secret compromise, incorrect implementation, chain compromise, external protocol bypasses. |
| P2 | Adoption requiring every protocol to change | Contract-compatible protocols can be called through the account without understanding its PQ signature. | EOA-only checks, unsupported ERC-1271 flows, frontend incompatibility. |
| P3 | Payload substitution | A valid signature fixes the intended action and constraints. | Market changes permitted by those constraints. |
| P4 | Duplicate or cross-context execution | Nonces, consumed-key rules, and domain separation prevent defined replay classes. | A still-live signed instruction remains executable until its expiry or invalidation. |
| P5 | Failure blocks the only next signing key | Independent committed keys permit a fresh-key replacement authorization. | The signer must never reuse an exposed OTS key; replacement races require explicit nonce semantics. |
| P6 | A copied payload can be delivered by an unwanted EOA | Optional allowedSubmitter restricts submission by other addresses. | Quantum impersonation of the allowed EOA, sequencing, censorship, sandwiching, or early submission by that EOA. |
| P7 | Permanent dependence on a particular gas-paying wallet | Open relay mode and optional per-operation submitters separate gas payment from ownership. | Gas still must be paid; an ephemeral EOA must be funded; historical linkage can remain visible. |
| P8 | Duplicated deployment code | Minimal accounts share a fixed implementation while retaining independent state. | Verification/data fees, factory initialization correctness, shared implementation bugs. |
| P9 | Deployment/admin key can silently bypass PQ checks | No continuing ECDSA owner, reset, or upgrade override exists in the selected initial architecture. | Authorized external token allowances and protocol control paths require separate integration analysis. |
| P10 | Privacy is confused with relayability | The system can avoid requiring the owner's EOA as the recurring sender. | It does not hide account balances, calls, recipients, submitters, or transaction timing. |

## Wording to preserve

Use “post-quantum authorization,” “independent signing authority,” “separate contract account,” “optional submitter restriction,” “broad contract compatibility,” and “designed to operate on existing EVM execution.”

Avoid “quantum-proof Ethereum,” “full privacy,” “MEV solved,” “compatible with everything,” “zero quantum attack opportunity,” “12 words give 256-bit entropy,” “forward secrecy from rotation alone,” “minting creates an NFT,” “Safe parity” without a demonstrated feature matrix, and any claim of audit or implementation that has not occurred.
