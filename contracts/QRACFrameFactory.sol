// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QRACAccount} from "./QRACAccount.sol";

/// @title QRAC frame factory (Phase 3)
/// @notice Same minting model as QRACFactory (45-byte ERC-1167 clones, CREATE2 with salt = keccak256(publicKey),
///         created AND initialized in one transaction, no owner, no upgrades), but the implementation is passed in:
///         a QRACFrameAccount deployed beforehand with an empty key (locked). Deploying the implementation in its
///         own transaction keeps each deployment under the per-transaction gas cap of the devnet.
contract QRACFrameFactory {
    address public immutable implementation;

    event AccountMinted(address indexed account, bytes32 indexed keyFingerprint, address indexed minter);

    error AlreadyMinted(address account);
    error CloneFailed();
    error NoImplementationCode();

    constructor(address implementation_) {
        if (implementation_.code.length == 0) revert NoImplementationCode();
        implementation = implementation_;
    }

    function mint(bytes calldata publicKey) external returns (address account) {
        bytes32 salt = keccak256(publicKey);
        address predicted = predictAddress(publicKey);
        if (predicted.code.length != 0) revert AlreadyMinted(predicted);
        account = _cloneDeterministic(implementation, salt);
        QRACAccount(payable(account)).initialize(publicKey);
        emit AccountMinted(account, salt, msg.sender);
    }

    function predictAddress(bytes calldata publicKey) public view returns (address) {
        return _predictDeterministicAddress(implementation, keccak256(publicKey), address(this));
    }

    function isMinted(bytes calldata publicKey) external view returns (bool) {
        return predictAddress(publicKey).code.length != 0;
    }

    function _cloneDeterministic(address impl, bytes32 salt) private returns (address instance) {
        assembly {
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create2(0, 0x09, 0x37, salt)
        }
        if (instance == address(0)) revert CloneFailed();
    }

    function _predictDeterministicAddress(address impl, bytes32 salt, address deployer)
        private
        pure
        returns (address predicted)
    {
        assembly {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x38), deployer)
            mstore(add(ptr, 0x24), 0x5af43d82803e903d91602b57fd5bf3ff)
            mstore(add(ptr, 0x14), impl)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73)
            mstore(add(ptr, 0x58), salt)
            mstore(add(ptr, 0x78), keccak256(add(ptr, 0x0c), 0x37))
            predicted := and(keccak256(add(ptr, 0x43), 0x55), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}
