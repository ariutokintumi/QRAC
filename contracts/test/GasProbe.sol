// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test-only helper: measures the execution gas of a single external call,
///         excluding the outer transaction's intrinsic and calldata costs.
contract GasProbe {
    function measure(address target, bytes calldata data)
        external
        returns (uint256 gasUsed, bool success, bytes memory ret)
    {
        uint256 before = gasleft();
        (success, ret) = target.call(data);
        gasUsed = before - gasleft();
    }
}
