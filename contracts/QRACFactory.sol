// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QRACAccount, ILMSVerifier} from "./QRACAccount.sol";

/// @title QRAC factory ("mint your account")
/// @notice Deploys ONE locked QRACAccount implementation in its constructor, then mints, for each user,
///         a 45-byte ERC-1167 minimal-proxy clone that runs the implementation's logic on its OWN storage
///         and balance. Creation and initialization happen in the same transaction (no front-running window).
///
///         Address = CREATE2(factory, salt = keccak256(publicKey), clone init code), so:
///           - the account address is known BEFORE minting (funds can be received in advance);
///           - an address is bound to its public key: nobody can mint that address with another key;
///           - minting is permissionless; whoever mints, the account is controlled only by that key.
///
///         The factory has no owner and no special rights over minted accounts. Clones point to a fixed
///         implementation forever (no upgrade path).
contract QRACFactory {
    /// Shared, locked account logic (created by this factory's constructor).
    address public immutable implementation;
    ILMSVerifier public immutable verifier;

    event AccountMinted(address indexed account, bytes32 indexed keyFingerprint, address indexed minter);

    error AlreadyMinted(address account);
    error CloneFailed();

    constructor(ILMSVerifier verifier_) {
        verifier = verifier_;
        implementation = address(new QRACAccount(verifier_, ""));
    }

    /// @notice Mint the QRAC account controlled by `publicKey` (56-byte LMS public key).
    function mint(bytes calldata publicKey) external returns (address account) {
        bytes32 salt = keccak256(publicKey);
        address predicted = predictAddress(publicKey);
        if (predicted.code.length != 0) revert AlreadyMinted(predicted);
        account = _cloneDeterministic(implementation, salt);
        QRACAccount(payable(account)).initialize(publicKey); // reverts on an invalid key -> whole mint reverts
        emit AccountMinted(account, salt, msg.sender);
    }

    /// @notice Address the account for `publicKey` has (or will have once minted).
    function predictAddress(bytes calldata publicKey) public view returns (address) {
        return _predictDeterministicAddress(implementation, keccak256(publicKey), address(this));
    }

    function isMinted(bytes calldata publicKey) external view returns (bool) {
        return predictAddress(publicKey).code.length != 0;
    }

    // ---------------------------------------------------------------------
    // ERC-1167 minimal proxy (same byte layout as OpenZeppelin Clones v5)
    // runtime: 363d3d373d3d3d363d73 <implementation> 5af43d82803e903d91602b57fd5bf3   (45 bytes)
    // ---------------------------------------------------------------------

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
