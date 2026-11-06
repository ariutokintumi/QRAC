# QRAC — AI handoff package

Prepared 6 November 2026. Project name: **QRAC** (QR Accounts; formerly "QRSC Account"). This package is portable: it contains the context needed to continue in a separate AI instance without access to the original chat.

## What the user wants

Build a focused ETHGlobal-style proof of concept: a personal EVM contract account controlled by post-quantum signatures, with a factory, reusable verification/account logic, and a dApp for creating and operating the account. Existing contract-compatible protocols should not need to integrate a special verifier themselves.

The user confirmed **24 BIP-39 words representing 256 bits of fresh entropy**. The earlier mention of 12 words is superseded. The user also clarified **one useful first release**, with only the functionality necessary to prove the concept. There is no request for a multi-release roadmap or complete Safe parity.

## Read in this order

1. [Project brief and architecture](01-PROJECT-BRIEF.md): purpose, discussion summary, decisions, components, threat model, transaction/key rules, and boundaries.
2. [Execution plan](02-EXECUTION-PLAN.md): ordered work packages for this single release, dependencies, deliverables, and exit criteria.
3. [Acceptance and capability matrix](03-ACCEPTANCE-AND-CAPABILITIES.md): what must work, how to prove it, and what is excluded.
4. [Pitch outline](04-PITCH-OUTLINE.md): possible slides, demo, scoped PROBLEMS SOLVED claims, and required evidence.
5. [Vitácora](05-VITACORA.md): running log of decisions and outcomes. **Decisions recorded there after 6 November 2026 take precedence over documents 01–04** (for example, the phased roadmap and the EIP-8141 / alt-mempool target).

The original Gemini transcript (`reference-first-gemini-conversation.txt`) is kept locally as historical reference only and is excluded from the repository via `.gitignore`. It contains claims that were corrected in the subsequent discussion. It is not an implementation specification and must not override this package.

## Current state

See [05-VITACORA.md](05-VITACORA.md) for the live status. At the time this package was prepared, only research and planning documents existed. **No verifier, contract account, factory, signer, dApp, test suite, deployment, gas benchmark, or audit has been completed.** Do not describe any proposed protection as validated until its acceptance tests pass. This package itself has been checked for consistency; that is not a security review of code.

There are no outstanding user questions blocking implementation analysis. Algorithm/parameter selection and technical stack choices remain engineering work for the next instance. Record those choices with evidence rather than claiming the user already selected them.

## Prompt to give the next AI

> Read all four numbered documents in this package before implementing. Treat the latest decisions in 01-PROJECT-BRIEF.md as authoritative and the original Gemini transcript as historical, partly incorrect source material. Execute the single-release plan in 02-EXECUTION-PLAN.md, using 03-ACCEPTANCE-AND-CAPABILITIES.md as the completion contract. Keep the scope small: a single PQ authority per account, atomic CALL-only transactions and batches, factory deployment, a 24-word independent seed, correct one-time-key state, root renewal, and optional submitter restrictions. Do not add full Safe parity, a roadmap, tokenomics, modules, ERC-4337, or privacy claims. Start by inspecting the actual workspace and validating the cryptographic implementation and target-chain feasibility. Preserve the threat model: trusted enrollment; quantum compromise of ECDSA allowed; PQ secret remains secret; correct chain execution assumed. General OPSEC is excluded, but preventing one-time-key reuse is mandatory. Choose reasonable implementation details autonomously, record them, and ask only when a decision would change the agreed product or security model. Test on local forks/testnets and report evidence honestly. Do not use real user secrets or spend real funds without separate authorization. Deliver a working reproducible prototype, source, tests, benchmark results, deployment records, and a pitch grounded in observed results.

## How to transfer

Attach the ZIP or all files in this folder to the new AI. If that AI cannot open ZIP files, attach the four numbered Markdown documents. They are readable text, not dependent on a particular AI product or workspace path. The README prompt is also sufficient to introduce the task once those documents are attached.
