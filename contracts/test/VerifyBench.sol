// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LMSVerifier} from "../LMSVerifier.sol";

/// Test-only: measures LMSVerifier.verify() gas on ANY chain with a read-only eth_call (no funds, no deployment).
/// Send the creation code + constructor args as an eth_call without `to`; the constructor deploys a temporary
/// verifier, measures one verification and always reverts with Result(valid, gasUsed). Nothing is ever stored.
contract VerifyBench {
    error Result(bool valid, uint256 gasUsed);

    constructor(bytes memory publicKey, bytes memory message, bytes memory signature) {
        LMSVerifier v = new LMSVerifier();
        uint256 g = gasleft();
        bool ok = v.verify(publicKey, message, signature);
        uint256 used = g - gasleft();
        revert Result(ok, used);
    }
}
