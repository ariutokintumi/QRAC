// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QRAC LMS verifier
/// @notice Stateless, ownerless verifier for Leighton-Micali hash-based signatures (RFC 8554),
///         SHA-256 parameter sets with n = m = 32 (LMS H5..H25, LM-OTS W1/W2/W4/W8).
///         It only answers "is this signature valid for this public key and message?".
///         It does NOT track which one-time keys were used: that is the account's job.
/// @dev    Uses the SHA-256 precompile (0x02). Never writes storage, so the same code can run
///         inside an EIP-8141 VERIFY frame (static context) later.
///         Compiles with default Remix settings (no viaIR needed).
contract LMSVerifier {
    uint256 private constant N = 32;

    uint256 private constant D_PBLC = 0x8080;
    uint256 private constant D_MESG = 0x8181;
    uint256 private constant D_LEAF = 0x8282;
    uint256 private constant D_INTR = 0x8383;

    /// @param publicKey u32 lmsType || u32 otsType || I (16 bytes) || root T[1] (32 bytes) = 56 bytes.
    /// @param message   The exact message bytes that were signed.
    /// @param signature u32 q || LM-OTS sig (u32 otsType || C || y[0..p-1]) || u32 lmsType || path[0..h-1].
    /// @return True only for a well-formed, valid signature. Malformed input returns false.
    function verify(bytes calldata publicKey, bytes calldata message, bytes calldata signature)
        external
        view
        returns (bool)
    {
        (bool ok, uint256 cfg) = _parse(publicKey, signature);
        if (!ok) return false;
        return _verifyParsed(publicKey, message, signature, cfg);
    }

    /// @notice Tree height for an LMS type code, or 0 if unsupported.
    function treeHeight(uint256 lmsType) public pure returns (uint256) {
        if (lmsType >= 5 && lmsType <= 9) return 5 * (lmsType - 4);
        return 0;
    }

    /// @notice (w, p, ls) for an LM-OTS type code, or zeros if unsupported.
    function otsParams(uint256 otsType) public pure returns (uint256 w, uint256 p, uint256 ls) {
        if (otsType == 1) return (1, 265, 7);
        if (otsType == 2) return (2, 133, 6);
        if (otsType == 3) return (4, 67, 4);
        if (otsType == 4) return (8, 34, 0);
        return (0, 0, 0);
    }

    /// @notice Expected signature length for a parameter set (0 if unsupported).
    function signatureLength(uint256 lmsType, uint256 otsType) public pure returns (uint256) {
        uint256 h = treeHeight(lmsType);
        (uint256 w, uint256 p,) = otsParams(otsType);
        if (h == 0 || w == 0) return 0;
        return 12 + N * (p + 1) + N * h;
    }

    // ---------------------------------------------------------------------
    // Parsing. cfg packs: h (bits 0-7) | w (8-15) | p (16-31) | ls (32-39)
    // ---------------------------------------------------------------------

    function _parse(bytes calldata publicKey, bytes calldata signature)
        private
        pure
        returns (bool, uint256)
    {
        if (publicKey.length != 56) return (false, 0);
        uint256 lmsType = uint32(bytes4(publicKey[0:4]));
        uint256 otsType = uint32(bytes4(publicKey[4:8]));
        uint256 h = treeHeight(lmsType);
        (uint256 w, uint256 p, uint256 ls) = otsParams(otsType);
        if (h == 0 || w == 0) return (false, 0);

        uint256 otsEnd = 8 + N * (p + 1); // end of the LM-OTS signature inside `signature`
        if (signature.length != otsEnd + 4 + N * h) return (false, 0);
        if (uint32(bytes4(signature[0:4])) >> h != 0) return (false, 0); // leaf index q < 2^h
        if (uint32(bytes4(signature[4:8])) != otsType) return (false, 0);
        if (uint32(bytes4(signature[otsEnd:otsEnd + 4])) != lmsType) return (false, 0);
        return (true, h | (w << 8) | (p << 16) | (ls << 32));
    }

    function _verifyParsed(bytes calldata publicKey, bytes calldata message, bytes calldata signature, uint256 cfg)
        private
        view
        returns (bool)
    {
        bytes32 root = bytes32(publicKey[24:56]);
        // Iq = I (16 bytes, left-aligned) || u32str(q): the common prefix of every LM-OTS hash.
        bytes32 Iq = bytes32(publicKey[8:24]) | bytes32(uint256(uint32(bytes4(signature[0:4]))) << 96);
        uint256 sigOff;
        assembly {
            sigOff := signature.offset
        }
        bytes32 kc;
        {
            uint256 S = _digestWithChecksum(Iq, cfg, bytes32(signature[8:40]), message);
            kc = _otsCandidate(Iq, cfg, S, sigOff + 8); // C || y[0..p-1] starts at byte 8
        }
        // path starts after q(4) || otsType(4) || C || y[0..p-1] || lmsType(4)
        uint256 pathOff = sigOff + 12 + N * (((cfg >> 16) & 0xffff) + 1);
        return _merkleRoot(Iq, cfg, kc, pathOff) == root;
    }

    // ---------------------------------------------------------------------
    // LM-OTS: RFC 8554 Algorithm 4b (candidate public key from signature)
    // ---------------------------------------------------------------------

    /// Writes S = Q || u16str(Cksm(Q)) to memory and returns its pointer, where
    /// Q = H(I || u32str(q) || u16str(D_MESG) || C || message).
    function _digestWithChecksum(bytes32 Iq, uint256 cfg, bytes32 C, bytes calldata message)
        private
        view
        returns (uint256 S)
    {
        assembly {
            function coef(buf, i, w) -> c {
                let shift := sub(8, add(mul(w, mod(i, div(8, w))), w))
                c := and(shr(shift, byte(0, mload(add(buf, shr(3, mul(i, w)))))), sub(shl(w, 1), 1))
            }

            S := mload(0x40)
            mstore(S, or(Iq, shl(80, D_MESG)))
            mstore(add(S, 22), C)
            calldatacopy(add(S, 54), message.offset, message.length)
            if iszero(staticcall(gas(), 0x02, S, add(54, message.length), S, 0x20)) { revert(0, 0) }

            let w := and(shr(8, cfg), 0xff)
            let sum := 0
            for { let i := 0 } lt(i, div(256, w)) { i := add(i, 1) } {
                sum := add(sum, sub(sub(shl(w, 1), 1), coef(S, i, w)))
            }
            sum := and(shl(and(shr(32, cfg), 0xff), sum), 0xffff)
            mstore8(add(S, 32), shr(8, sum))
            mstore8(add(S, 33), and(sum, 0xff))
            mstore(0x40, add(S, 0x40))
        }
    }

    /// Kc = H(I || u32str(q) || u16str(D_PBLC) || z[0] || ... || z[p-1]),
    /// z[i] = chain(y[i]) from digit a_i up to 2^w - 1.
    /// @param cyOff calldata offset of C || y[0] || ... || y[p-1]
    function _otsCandidate(bytes32 Iq, uint256 cfg, uint256 S, uint256 cyOff)
        private
        view
        returns (bytes32 kc)
    {
        assembly {
            // Memory at m: [m, m+55) chain buffer I(16) | q(4) | u16 i | u8 j | tmp(32),
            //              [m+64, m+96) w,   [m+96, ...) Kc preimage.
            // step(i): z[i] = chain(y[i]) for j = a_i .. 2^w - 2; each hash overwrites tmp in place.
            function step(buf, sPtr, yOff, prefixIq, idx) -> z {
                let w := mload(add(buf, 0x40))
                let start := and(
                    shr(sub(8, add(mul(w, mod(idx, div(8, w))), w)), byte(0, mload(add(sPtr, shr(3, mul(idx, w)))))),
                    sub(shl(w, 1), 1)
                )
                mstore(buf, or(prefixIq, shl(80, idx)))
                mstore(add(buf, 23), calldataload(add(yOff, shl(5, add(idx, 1)))))
                for { let j := start } lt(j, sub(shl(w, 1), 1)) { j := add(j, 1) } {
                    mstore8(add(buf, 22), j)
                    if iszero(staticcall(gas(), 0x02, buf, 55, add(buf, 23), 0x20)) { revert(0, 0) }
                }
                z := mload(add(buf, 23))
            }

            let m := mload(0x40)
            mstore(add(m, 0x40), and(shr(8, cfg), 0xff)) // w
            let kend := add(m, add(118, shl(5, and(shr(16, cfg), 0xffff)))) // m + 96 + 22 + 32p
            mstore(0x40, add(kend, 0x20))
            mstore(add(m, 0x60), or(Iq, shl(80, D_PBLC)))
            let i := 0
            for { let o := add(m, 118) } lt(o, kend) { o := add(o, 0x20) } {
                mstore(o, step(m, S, cyOff, Iq, i))
                i := add(i, 1)
            }
            if iszero(staticcall(gas(), 0x02, add(m, 0x60), sub(kend, add(m, 0x60)), 0x00, 0x20)) { revert(0, 0) }
            kc := mload(0x00)
        }
    }

    // ---------------------------------------------------------------------
    // LMS: RFC 8554 Algorithm 6a (root from leaf candidate and authentication path)
    // ---------------------------------------------------------------------

    /// @param pathOff calldata offset of path[0] || ... || path[h-1]
    function _merkleRoot(bytes32 Iq, uint256 cfg, bytes32 kc, uint256 pathOff)
        private
        view
        returns (bytes32 tmp)
    {
        assembly {
            let I := and(Iq, not(sub(shl(128, 1), 1)))
            let h := and(cfg, 0xff)
            let node := add(shl(h, 1), and(shr(96, Iq), 0xffffffff))
            let m := mload(0x40)
            mstore(m, or(I, or(shl(96, node), shl(80, D_LEAF))))
            mstore(add(m, 22), kc)
            if iszero(staticcall(gas(), 0x02, m, 54, 0x00, 0x20)) { revert(0, 0) }
            tmp := mload(0x00)
            for { let i := 0 } gt(node, 1) { i := add(i, 1) } {
                let sibling := calldataload(add(pathOff, shl(5, i)))
                let parent := shr(1, node)
                mstore(m, or(I, or(shl(96, parent), shl(80, D_INTR))))
                switch and(node, 1)
                case 1 {
                    mstore(add(m, 22), sibling)
                    mstore(add(m, 54), tmp)
                }
                default {
                    mstore(add(m, 22), tmp)
                    mstore(add(m, 54), sibling)
                }
                if iszero(staticcall(gas(), 0x02, m, 86, 0x00, 0x20)) { revert(0, 0) }
                tmp := mload(0x00)
                node := parent
            }
        }
    }
}
