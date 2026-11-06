# ETHGlobal submission texts

Copy-paste source for the submission form. Keep it in sync with what is really deployed.

Links:
- Website: https://qrac.me
- Code: https://github.com/ariutokintumi/QRAC
- PQ-signed transfer on Sepolia: https://sepolia.etherscan.io/tx/0x0538b564be006bfb5d70cd8b0d1d2fa60045863fc53fa41ef6d60735005abb5c
- PQ frame transaction admitted by the alternative mempool: https://explorer.altmempool.wtf/tx/0x2f414a944f74a803e5d3e59eb98e9bd56f2c0a6e87be9bcf5cfa42e65026f4f0

## 1. Short description (max 100 characters)

Post-quantum accounts for Ethereum, working today and ready for EIP-8141 frame transactions.

(92 characters. Shorter option: "Post-quantum accounts for Ethereum, working from today!", 55 characters.)

## 2. Description

QRAC.me (QR Accounts) is a dApp that gives you a post-quantum Ethereum account today, on the current network, and that already works with EIP-8141 frame transactions for when Ethereum gets native account abstraction.

The problem: every normal Ethereum account is controlled by one ECDSA key. If that key leaks, or a quantum computer breaks it one day, everything in the account is gone, and changing that at the protocol level will take years.

How QRAC.me works: you create a 24-word seed (256 bits, independent of any wallet). The dApp turns it into 1,024 one-time post-quantum keys (LMS / LM-OTS from RFC 8554, only hashes, nothing that a quantum computer breaks). You mint a small smart account (a 45-byte clone of shared logic, address known before it exists) whose only owner is the root of that key tree. To move funds, call a token, an NFT or any contract, or run a batch of calls, you sign the exact action with a one-time key. The account verifies that signature on-chain before doing anything. Any wallet can deliver it and pay the gas, but no wallet owns the account: the deployer's or funder's ECDSA key can't move a single wei. One-time keys are never reused (they are reserved before signing), a failed transaction never locks you out (sign a replacement with a fresh key), you can cancel a pending action, and you can rotate to a new key tree before the keys run out.

It runs on Sepolia today: a real transfer authorized only by a post-quantum signature, accounts minted through the factory (738k gas instead of 10.5M), and simulated attacks with a leaked deployer key all refused.

The same account idea goes further with frame transactions. On the EIP-8141 devnet the QRAC.me account validates its own transactions in a VERIFY frame: the transaction carries only the post-quantum signature (zero ECDSA), the account approves and pays its own gas, and each one-time key is used as an EIP-8250 nonce key, so the network itself refuses to accept a key twice. The post-quantum check needs about 250k gas of validation. The public mempool refuses it (limit 100k) and the ERC-8421 alternative mempool accepts it, which is exactly what we show in the dApp side by side, with the explorer link of the admitted transaction.

The frame-ready contract is the same QRAC.me account plus native frame validation, so it works with today's transactions and with frame transactions. The goal is that the account you create now keeps its address and funds when the migration happens.

Testnets only, not audited.

## 3. How it's made

Contracts (Solidity 0.8.28, with inline assembly where it matters):
- `LMSVerifier`: a stateless LMS / LM-OTS verifier (RFC 8554, SHA-256 parameter sets) that calls the SHA-256 precompile in tight assembly loops. About 172k to 220k gas per signature with H10/W4 (1,024 keys, 2,508-byte signatures). It checks the official RFC 8554 test vectors on-chain, including on Sepolia and on the devnet.
- `QRACAccount`: the account. One state-changing entry point (`submit`), no owner, no admin, no upgrades. It keeps the key root, an epoch, a nonce and a bitmap of used one-time keys, and it runs batches of calls all-or-nothing.
- `QRACFactory`: mints ERC-1167 clones with CREATE2 (salt = hash of the public key) and initializes them in the same transaction.
- `QRACFrameAccount` + `QRACFrameFactory`: the account plus a VERIFY-frame entry for EIP-8141. It reads the signature hash (TXPARAM) and our signature from an ARBITRARY signature entry (SIGDATACOPY), checks that the transaction uses exactly the nonce key bound to that one-time key with sequence 0, verifies with the shared verifier and calls APPROVE. Solidity can't emit the new opcodes, so we used `HegotaSupport` (MIT, vendored), which reaches them through tiny helper contracts with delegatecall. That works even through our clones (clone, implementation, helper).

Python, used as the reference and the test bench: our own LMS implementation that reproduces the RFC 8554 Test Case 2 key tree and signature byte for byte; the authorization encoder; a frame-transaction codec (RLP and signature hash), checked against the devnet by sending a transaction and getting back exactly our hash; 101 tests on an in-memory EVM (py-evm through eth-tester, solc through py-solc-x), including an attacker holding the deployer's key and every account test repeated on standalone, minted and frame accounts; a small JSON-RPC dev node for offline demos; and a devnet script that funds, deploys, mints, stakes, sends and runs attacks.

dApp: plain HTML, CSS and JavaScript, no build step and no backend. ethers v6 from a CDN. SHA-256 and LMS written in JavaScript (WebCrypto is too slow for about a million hashes), the key tree built in a Web Worker in 1 to 3.5 seconds, and BIP-39 and HMAC key derivation with WebCrypto. A signer journal in localStorage reserves each one-time key before signing and is exported as a JSON file after every signature. Before signing, the dApp asks the contract for the exact message bytes and refuses to sign if they differ from its own. A self-test page checks the browser against the Python references.

Partner tech (EF frame transactions and the ERC-8421 alternative mempool): the devnet, the sidecar's `eth_sendFrameTransaction`, `ethrex_simulateFrameTransaction` to show the public mempool's verdict before submitting, the faucet, the staking registry and the explorer. Without the alternative mempool our wallet simply can't exist with frame transactions, because validation needs about 250k gas.

Hacky bits worth mentioning:
- The verifier compiles with default Remix settings (no viaIR) because we packed parameters into one word and moved the hot loops into Yul functions.
- We measure verification gas on any chain with a read-only `eth_call` whose creation code deploys a temporary verifier, verifies and reverts with the gas used. No funds, nothing stored.
- One-time keys mapped to EIP-8250 nonce keys give a hash-based wallet protocol-level single use, without storage writes in a static VERIFY frame.
- The account stakes itself for the alternative mempool through its normal-transaction path, because a staking frame transaction would itself need more validation gas than an unstaked sender gets.

## 4. Ethereum developer tools

- ethers.js (v6, in the dApp)
- Etherscan (Sepolia explorer)
- Other, if there is a free field: py-solc-x (solc), eth-tester / py-evm, eth-abi, eth-account

Not used, so don't tick them: Foundry, Hardhat, viem, wagmi. Remix: the contracts are Remix-compatible, but we deployed from our dApp. Tick Remix only if you also use it.

## 5. Blockchain networks

- Ethereum Sepolia
- Other: EIP-8141 frame-transaction devnet with the ERC-8421 alternative mempool (chain ID 1337)

Not Ethereum mainnet.

## 6. Programming languages

Solidity, Python, JavaScript, HTML/CSS. Yul too if listed (inline assembly in the verifier and the factory).

## 7. Web frameworks

None (plain HTML, CSS and JavaScript ES modules).

## 8. Databases

None (only the browser's localStorage, plus JSON files the user downloads).

## 9. Design tools

None.

## 10. Other technologies

LMS / LM-OTS (RFC 8554), BIP-39, EIP-8141 frame transactions, ERC-8421 alternative mempool, EIP-8250 keyed nonces, ERC-1167 minimal proxies, CREATE2, SHA-256 precompile, HegotaSupport (@forshtat/hegota-support), ethrex, Web Workers, WebCrypto, py-evm, eth-tester, py-solc-x, eth-abi, eth-account, rlp, jsDelivr

## 11. AI tools

- Google Gemini: the first research chat, to check whether the original idea was feasible. Several of its claims were later corrected.
- ChatGPT (Astra): turned the idea into the architecture brief, execution plan, acceptance criteria and pitch outline (the documents in `qrac-ai-handoff/`).
- Claude Code (Claude Opus 5.5) in the Claude desktop app, for all the development: the Solidity contracts, the Python reference implementation and tests, the dApp, the local dev node and the devnet script; running tests and debugging; testing the dApp in the app's built-in browser; checking our Sepolia and devnet transactions from raw chain data; and drafting the README, docs, the decision log (vitácora) and these texts.
- Claude also drafted the first logo and cover, the User mode design and the first version of the slides.
- The team: the idea, the scope and product decisions, review of everything, the final logo and cover (refined from Claude's drafts), the Sepolia runs with Brave Wallet, the manual tests on the website, and the final wording.
- Next: we plan to use Claude to help draft the demo video script. The recording is ours.

## 12. Frame Transactions (EF): how we use it

Why we apply: a post-quantum wallet is the case the alternative mempool exists for. Our account validates its own frame transactions with a hash-based signature that costs about 250k gas, the public mempool rejects it (100k limit), and the ERC-8421 alternative mempool admits it. We show both verdicts live in the dApp, with zero ECDSA in the transaction, the account paying its own gas, and one-time keys enforced by keyed nonces.

Code (VERIFY frame approval): https://github.com/ariutokintumi/QRAC/blob/main/contracts/QRACFrameAccount.sol#L82

Admitted transaction on the devnet explorer: https://explorer.altmempool.wtf/tx/0x2f414a944f74a803e5d3e59eb98e9bd56f2c0a6e87be9bcf5cfa42e65026f4f0

Feedback (errors we hit while building, and how we got around them):
1. ethers v6 reported a funding transaction as failed, but it had been mined. The devnet returns frame transactions in normal RPC responses, ethers can't parse them, and `tx.wait()` threw while reading a block that contained one. We now send those transactions raw and poll the receipt ourselves. A warning in the docs or an ethers formatter for type 0x06 would help.
2. Replaying an already-mined frame transaction was rejected with "prefix gas budget exceeded" instead of the real reason (nonce already used). We found the real reason with `ethrex_simulateFrameTransaction`. The sidecar puts the canonical violation before the execution error.
3. Our unstaked account (about 255k validation gas) was admitted, while the docs say unstaked senders get 100k. We stake anyway, so we follow the rule as written.
4. The devnet guide says there is no faucet, but the gateway has one (`skandha_explorer_faucet`) and the workshop uses it. We used it too.
5. One evening our frame transactions were admitted by the gateway but never mined: status stayed "New" and the miner sidecar answered "Frame transaction not found" for the same hash. Sending them to the miner sidecar (`https://altmempool.forshtat.com/rpc`) got them mined in seconds, so the dApp now submits there first and uses the gateway as a fallback. Listing that endpoint in the docs would help.

What worked very well: the simulation RPC and the explorer's admission report made debugging quick, HegotaSupport worked through our clones on the first try, and keyed nonces fit hash-based one-time keys perfectly.

Full details and reproduction steps: https://github.com/ariutokintumi/QRAC/blob/main/docs/FEEDBACK-ALT-MEMPOOL.md
