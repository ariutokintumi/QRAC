# Vendored: @forshtat/hegota-support 0.0.1 (MIT)

Source: npm package [`@forshtat/hegota-support@0.0.1`](https://www.npmjs.com/package/@forshtat/hegota-support) by Alex Forshtat ([repository](https://github.com/forshtat/hegota-support)), `contracts/` folder, copied unmodified. License: [LICENSE](LICENSE) (MIT).

It gives plain Solidity (standard solc 0.8.28) access to the EIP-8141 frame-transaction opcodes (`APPROVE`, `TXPARAM`, `SIGPARAM`, `SIGDATACOPY`, …) through one tiny Yul helper contract per opcode, deployed by the inheriting contract's constructor. `APPROVE` runs through `delegatecall`, so it acts on the account that inherits `HegotaSupport`.

Used only by the Phase 3 contracts (`QRACFrameAccount`). The Phase 1–2 contracts do not import it.
