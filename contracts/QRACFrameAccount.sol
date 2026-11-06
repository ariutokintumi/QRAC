// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {QRACAccount, ILMSVerifier} from "./QRACAccount.sol";
import {HegotaSupport} from "./vendor/hegota-support/HegotaSupport.sol";
import {Devnet} from "./vendor/hegota-support/Devnet.sol";
import {Scope, TxParam, SigParam} from "./vendor/hegota-support/Params.sol";

/// @title QRAC frame account (Phase 3: EIP-8141 frame transactions + ERC-8421 alternative mempool)
/// @notice Everything QRACAccount does (the Phase 1 `submit()` path keeps working with ordinary transactions),
///         PLUS native validation of EIP-8141 frame transactions:
///
///   frame 0  VERIFY  target = this account, data = validateFrameTx(), flags = EXECUTION_AND_PAYMENT
///   frame 1+ SENDER  the actual actions (ETH sends, token calls, batches), executed with this account as caller
///
///   signatures[0] = { scheme: ARBITRARY, msg: empty, signature: <LMS signature over frameMessage(sigHash)> }
///   nonceKeys     = [ frameNonceKey(epoch, leaf) ],  nonceSeq = 0
///
/// The VERIFY frame checks the post-quantum (LMS, RFC 8554) signature over the transaction's signature hash with
/// the shared LMSVerifier, then calls APPROVE. No ECDSA is involved: the transaction carries no secp256k1
/// signature at all and the account pays its own gas.
///
/// One-time-key safety without storage writes (VERIFY frames are static): the transaction must use exactly one
/// EIP-8250 nonce key derived from (epoch, leaf) with sequence 0. The protocol advances that key when the
/// transaction is included, so the same one-time key can never authorize a second frame transaction.
///
/// Validation stays inside ERC-8421 rules: no TIMESTAMP/NUMBER, reads only this account's own storage, calls only
/// contracts with code (the helpers and the verifier) and the SHA-256 precompile. It costs ~200k gas, above the
/// 100k budget of unstaked entities: the account must be STAKED to use the standard alternative mempool.
contract QRACFrameAccount is QRACAccount, HegotaSupport {
    bytes32 public constant FRAME_DOMAIN = keccak256("QRAC.FrameTx.v1");
    uint256 private constant SCHEME_ARBITRARY = 0;

    error FrameSignatureNotArbitrary(uint256 scheme);
    error FrameSignatureTooShort();
    error WrongNonceKeyCount(uint256 count);
    error WrongNonceKey(uint256 expected, uint256 provided);
    error NonceSequenceNotZero(uint256 sequence);
    error LeafUsedOnLegacyPath(uint64 epoch, uint32 leaf);
    error BadFrameSignature();

    /// @param verifier_        Shared LMSVerifier.
    /// @param initialPublicKey Empty = locked implementation for QRACFrameFactory clones; otherwise a standalone account.
    constructor(ILMSVerifier verifier_, bytes memory initialPublicKey)
        QRACAccount(verifier_, initialPublicKey)
        HegotaSupport(Devnet.ERC8421_WORKSHOP)
    {}

    /// @notice The EIP-8250 nonce key a frame transaction signed with one-time key `leaf` of `epoch_` must use.
    ///         Key 0 is the ordinary account nonce, hence the +1.
    function frameNonceKey(uint64 epoch_, uint32 leaf) public pure returns (uint256) {
        return ((uint256(epoch_) << 32) | uint256(leaf)) + 1;
    }

    /// @notice The exact bytes the LMS key signs for a frame transaction with signature hash `sigHash`.
    function frameMessage(bytes32 sigHash) public pure returns (bytes memory) {
        return abi.encode(FRAME_DOMAIN, sigHash);
    }

    /// @notice VERIFY-frame entry point. Reverts (transaction invalid) unless the post-quantum signature is valid.
    function validateFrameTx() external {
        if (sigparam(0, SigParam.SCHEME) != SCHEME_ARBITRARY) {
            revert FrameSignatureNotArbitrary(sigparam(0, SigParam.SCHEME));
        }
        bytes memory signature = sigdatacopy(0, sigparam(0, SigParam.SIGNATURE_LENGTH), 0);
        if (signature.length < 4) revert FrameSignatureTooShort();
        uint32 leaf = uint32(bytes4(signature));
        uint64 ep = epoch;

        uint256 keyCount = txparam(TxParam.NONCE_KEY_COUNT);
        if (keyCount != 1) revert WrongNonceKeyCount(keyCount);
        uint256 key = txparam(TxParam.NONCE_KEY_0);
        if (key != frameNonceKey(ep, leaf)) revert WrongNonceKey(frameNonceKey(ep, leaf), key);
        uint256 seq = txparam(TxParam.NONCE);
        if (seq != 0) revert NonceSequenceNotZero(seq);
        // also refuse a leaf already consumed by the Phase 1 submit() path
        if (isLeafUsed(ep, leaf)) revert LeafUsedOnLegacyPath(ep, leaf);

        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        if (!verifier.verify(publicKey(), frameMessage(sigHash), signature)) revert BadFrameSignature();

        approve(Scope.EXECUTION_AND_PAYMENT);
    }
}
