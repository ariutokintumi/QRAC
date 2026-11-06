// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface of the shared, stateless LMS verifier (contracts/LMSVerifier.sol).
interface ILMSVerifier {
    function verify(bytes calldata publicKey, bytes calldata message, bytes calldata signature)
        external
        view
        returns (bool);

    function signatureLength(uint256 lmsType, uint256 otsType) external pure returns (uint256);
}

/// @title QRAC account
/// @notice A personal contract account controlled ONLY by a post-quantum LMS key (RFC 8554).
///         Two ways to exist:
///           - standalone: deployed with a public key in the constructor (Phase 1);
///           - minted: an ERC-1167 minimal-proxy clone created AND initialized in one transaction by
///             QRACFactory (Phase 2). The shared implementation is deployed with an empty key, which
///             locks it forever: it can never be initialized or used.
///         Assets belong to this contract. Any EOA can pay gas to deliver a signed authorization
///         (open mode), or the signature can name the only allowed submitter (restricted mode).
///         There is no owner EOA, no admin, no upgrade and no ECDSA path of any kind.
///
/// Signed message (exact bytes passed to the LMS verifier):
///   abi.encode(DOMAIN, chainId, account, epoch, nonce, leaf, kind,
///              allowedSubmitter, validAfter, validUntil, payload)
/// Payload by kind:
///   EXECUTE: abi.encode(Call[])            ordered, all-or-nothing batch of CALLs
///   ROTATE:  abi.encode(bytes newPublicKey, uint64 nextEpoch)
///   CANCEL:  empty                         consumes the current nonce, does nothing else
///
/// State:
///   - one current LMS public key (parameter set fixed for the account's lifetime) and its epoch
///   - a monotonic action nonce (never reset, also not by rotation)
///   - consumed one-time keys (leaves) per epoch
///   - fingerprints of every key ever installed (a past key can never be reinstalled)
contract QRACAccount {
    // ---------------------------------------------------------------------
    // Types and constants
    // ---------------------------------------------------------------------

    struct Header {
        uint64 epoch; // must equal the current key epoch
        uint64 nonce; // must equal the current action nonce
        uint8 kind; // KIND_EXECUTE | KIND_ROTATE | KIND_CANCEL
        address allowedSubmitter; // address(0) = anyone may submit; otherwise must equal msg.sender
        uint64 validAfter; // unix seconds; 0 = no lower bound
        uint64 validUntil; // unix seconds; 0 = no expiry
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
        bool checkReturn; // if true, the call must return nothing or exactly abi.encode(true) (ERC-20 style)
    }

    bytes32 public constant DOMAIN = keccak256("QRAC.Authorization.v1");

    uint8 public constant KIND_EXECUTE = 1;
    uint8 public constant KIND_ROTATE = 2;
    uint8 public constant KIND_CANCEL = 3;

    uint256 public constant MAX_CALLS = 32;
    uint256 private constant MAX_REVERT_DATA = 256;

    ILMSVerifier public immutable verifier;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// u32 lmsType || u32 otsType || I (16 bytes), left-aligned; low 8 bytes zero.
    bytes32 private _keyHead;
    /// LMS root T[1].
    bytes32 private _keyRoot;

    uint64 public epoch;
    uint64 public nonce;
    /// Lifecycle + reentrancy guard:
    /// 0 = not initialized (fresh clone) · 1 = active, idle · 2 = active, executing · 3 = locked implementation.
    uint256 private _locked;

    /// Consumed leaves: key = (epoch << 32) | (leaf >> 8), bit = leaf & 0xff.
    mapping(uint256 => uint256) private _usedLeaves;
    /// keccak256(publicKey) of every key ever installed in this account.
    mapping(bytes32 => bool) public keyFingerprintUsed;

    // ---------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------

    event AccountCreated(address indexed verifier, bytes32 indexed keyFingerprint);
    event AuthorizationUsed(
        uint64 indexed nonce, uint64 indexed epoch, uint32 leaf, uint8 kind, address indexed submitter
    );
    event KeyRotated(uint64 indexed newEpoch, bytes32 indexed newKeyFingerprint);
    event Received(address indexed from, uint256 amount);

    error Reentrancy();
    error AccountNotActive();
    error AlreadyInitialized();
    error InvalidPublicKey();
    error UnknownKind(uint8 kind);
    error WrongEpoch(uint64 expected, uint64 provided);
    error WrongNonce(uint64 expected, uint64 provided);
    error SubmitterNotAllowed(address allowed, address caller);
    error NotYetValid(uint64 validAfter);
    error Expired(uint64 validUntil);
    error LeafAlreadyUsed(uint64 epoch, uint32 leaf);
    error BadSignature();
    error EmptyBatch();
    error TooManyCalls();
    error SelfCallNotAllowed(uint256 index);
    error CallFailed(uint256 index, bytes revertData);
    error BadReturnValue(uint256 index);
    error CancelPayloadNotEmpty();
    error BadNextEpoch(uint64 expected, uint64 provided);
    error ParameterSetChange();
    error KeyAlreadyUsed(bytes32 fingerprint);

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param verifier_        Shared LMSVerifier (immutable: clones inherit it from the implementation's code).
    /// @param initialPublicKey 56-byte LMS public key, parameter set fixed for the account's lifetime.
    ///                         EMPTY = deploy the locked implementation used by QRACFactory clones.
    /// @dev The deployer receives no rights of any kind.
    constructor(ILMSVerifier verifier_, bytes memory initialPublicKey) {
        verifier = verifier_;
        if (initialPublicKey.length == 0) {
            _locked = 3; // implementation: can never be initialized or used
        } else {
            _initialize(initialPublicKey);
        }
    }

    /// @notice One-shot initialization of a fresh clone. QRACFactory calls it in the SAME transaction
    ///         that creates the clone, so no one can initialize someone else's account in between.
    function initialize(bytes calldata initialPublicKey) external {
        if (_locked != 0) revert AlreadyInitialized();
        _initialize(initialPublicKey);
    }

    // ---------------------------------------------------------------------
    // The only spending / configuration entry point
    // ---------------------------------------------------------------------

    /// @notice Execute one PQ-authorized action.
    /// @param h          Signed header fields.
    /// @param payload    Signed payload (see contract docs).
    /// @param signature  LMS signature over `authorizationMessage(h, leaf, payload)`; leaf = first 4 bytes.
    function submit(Header calldata h, bytes calldata payload, bytes calldata signature) external {
        if (_locked != 1) {
            if (_locked == 2) revert Reentrancy();
            revert AccountNotActive();
        }
        _locked = 2;

        uint32 leaf = _checkAndConsume(h, payload, signature);

        if (h.kind == KIND_EXECUTE) {
            _execute(payload);
        } else if (h.kind == KIND_ROTATE) {
            _rotate(payload);
        } else if (payload.length != 0) {
            revert CancelPayloadNotEmpty();
        }

        emit AuthorizationUsed(h.nonce, h.epoch, leaf, h.kind, msg.sender);
        _locked = 1;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The exact bytes that must be LMS-signed for this header, leaf and payload.
    function authorizationMessage(Header calldata h, uint32 leaf, bytes calldata payload)
        public
        view
        returns (bytes memory)
    {
        return abi.encode(
            DOMAIN,
            block.chainid,
            address(this),
            h.epoch,
            h.nonce,
            leaf,
            h.kind,
            h.allowedSubmitter,
            h.validAfter,
            h.validUntil,
            payload
        );
    }

    /// @notice Current 56-byte LMS public key.
    function publicKey() public view returns (bytes memory) {
        return abi.encodePacked(bytes24(_keyHead), _keyRoot);
    }

    function isLeafUsed(uint64 epoch_, uint32 leaf) public view returns (bool) {
        return (_usedLeaves[(uint256(epoch_) << 32) | (leaf >> 8)] >> (leaf & 0xff)) & 1 == 1;
    }

    // ---------------------------------------------------------------------
    // Asset reception (no authority is granted by any of these)
    // ---------------------------------------------------------------------

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x150b7a02 // ERC-721 receiver
            || interfaceId == 0x4e2312e0; // ERC-1155 receiver
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// Checks every rule, verifies the PQ signature, then consumes the leaf and the nonce
    /// BEFORE any external call. A later revert (e.g. a failing batch call) undoes all of it.
    function _checkAndConsume(Header calldata h, bytes calldata payload, bytes calldata signature)
        private
        returns (uint32 leaf)
    {
        if (h.kind != KIND_EXECUTE && h.kind != KIND_ROTATE && h.kind != KIND_CANCEL) revert UnknownKind(h.kind);
        if (h.epoch != epoch) revert WrongEpoch(epoch, h.epoch);
        if (h.nonce != nonce) revert WrongNonce(nonce, h.nonce);
        if (h.allowedSubmitter != address(0) && h.allowedSubmitter != msg.sender) {
            revert SubmitterNotAllowed(h.allowedSubmitter, msg.sender);
        }
        if (block.timestamp < h.validAfter) revert NotYetValid(h.validAfter);
        if (h.validUntil != 0 && block.timestamp > h.validUntil) revert Expired(h.validUntil);
        if (signature.length < 4) revert BadSignature();

        leaf = uint32(bytes4(signature[0:4]));
        if (isLeafUsed(h.epoch, leaf)) revert LeafAlreadyUsed(h.epoch, leaf);

        if (!verifier.verify(publicKey(), authorizationMessage(h, leaf, payload), signature)) revert BadSignature();

        _usedLeaves[(uint256(h.epoch) << 32) | (leaf >> 8)] |= uint256(1) << (leaf & 0xff);
        nonce = h.nonce + 1;
    }

    function _execute(bytes calldata payload) private {
        Call[] memory calls = abi.decode(payload, (Call[]));
        if (calls.length == 0) revert EmptyBatch();
        if (calls.length > MAX_CALLS) revert TooManyCalls();
        for (uint256 i = 0; i < calls.length; ++i) {
            _call(i, calls[i]);
        }
    }

    function _call(uint256 index, Call memory c) private {
        if (c.target == address(this)) revert SelfCallNotAllowed(index);
        address target = c.target;
        uint256 value = c.value;
        bytes memory data = c.data;
        bool success;
        uint256 rsize;
        uint256 word;
        assembly {
            // Return data is NOT copied wholesale (protects against return-data bombs).
            success := call(gas(), target, value, add(data, 0x20), mload(data), 0, 0)
            rsize := returndatasize()
            if and(success, eq(rsize, 0x20)) {
                returndatacopy(0x00, 0x00, 0x20)
                word := mload(0x00)
            }
        }
        if (!success) {
            uint256 n = rsize > MAX_REVERT_DATA ? MAX_REVERT_DATA : rsize;
            bytes memory reason = new bytes(n);
            assembly {
                returndatacopy(add(reason, 0x20), 0, n)
            }
            revert CallFailed(index, reason);
        }
        if (c.checkReturn && !(rsize == 0 || (rsize == 0x20 && word == 1))) revert BadReturnValue(index);
    }

    function _rotate(bytes calldata payload) private {
        (bytes memory newPublicKey, uint64 nextEpoch) = abi.decode(payload, (bytes, uint64));
        if (nextEpoch != epoch + 1) revert BadNextEpoch(epoch + 1, nextEpoch);
        if (newPublicKey.length != 56) revert InvalidPublicKey();
        // The parameter set (u32 lmsType || u32 otsType) is fixed for the account's lifetime.
        if (bytes8(_keyHead) != bytes8(bytes32(newPublicKey))) revert ParameterSetChange();
        bytes32 fp = _installKey(newPublicKey);
        epoch = nextEpoch;
        emit KeyRotated(nextEpoch, fp);
    }

    function _initialize(bytes memory initialPublicKey) private {
        _locked = 1;
        bytes32 fp = _installKey(initialPublicKey);
        emit AccountCreated(address(verifier), fp);
    }

    function _installKey(bytes memory pk) private returns (bytes32 fp) {
        if (pk.length != 56) revert InvalidPublicKey();
        bytes32 head;
        bytes32 root;
        assembly {
            head := and(mload(add(pk, 0x20)), not(0xffffffffffffffff)) // first 24 bytes
            root := mload(add(pk, 0x38)) // bytes 24..55
        }
        uint256 lmsType = uint32(bytes4(head));
        uint256 otsType = uint32(bytes4(head << 32));
        if (verifier.signatureLength(lmsType, otsType) == 0) revert InvalidPublicKey();
        fp = keccak256(pk);
        if (keyFingerprintUsed[fp]) revert KeyAlreadyUsed(fp);
        keyFingerprintUsed[fp] = true;
        _keyHead = head;
        _keyRoot = root;
    }
}
