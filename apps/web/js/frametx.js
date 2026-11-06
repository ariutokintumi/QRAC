// EIP-8141 frame transactions as implemented by the alt-mempool devnet (chain 1337). Browser port of
// tools/qrac/frametx.py (which the devnet accepted byte for byte); checked against it in test.html.
//
//   raw     = 0x06 || rlp([chainId, nonceKeys, nonceSeq, sender, frames, signatures, fees, blobHashes, recentRoots])
//   frame   = [mode, flags, target, [executionGas, stateGas], value, data]   (target empty = tx.sender)
//   sig     = [scheme, signer, msg, signature]
//   sigHash = keccak256(raw with the `signature` of every empty-`msg` entry set to empty)

import { encodeRlp, keccak256, toBeArray, getAddress, concat, hexlify } from './eth.js';

export const MODE = { DEFAULT: 0, VERIFY: 1, SENDER: 2 };
export const SCOPE = { NONE: 0, PAYMENT: 1, EXECUTION: 2, EXECUTION_AND_PAYMENT: 3 };
export const SCHEME = { ARBITRARY: 0, SECP256K1: 1, P256: 2 };

const int = (n) => toBeArray(BigInt(n)); // minimal big-endian bytes, 0 -> empty
const q = (n) => '0x' + BigInt(n).toString(16);

function payload(tx) {
  return [
    int(tx.chainId),
    tx.nonceKeys.map(int),
    int(tx.nonceSeq),
    tx.sender,
    tx.frames.map((f) => [int(f.mode), int(f.flags), f.target || '0x', [int(f.execution), int(f.state || 0)],
      int(f.value || 0), f.data || '0x']),
    tx.signatures.map((s) => [int(s.scheme), s.signer || '0x', s.msg || '0x', s.signature || '0x']),
    [int(tx.maxPriorityFeePerGas), int(tx.maxFeePerGas), int(tx.maxFeePerBlobGas || 0)],
    [],
    [],
  ];
}

export function raw(tx) {
  return concat(['0x06', encodeRlp(payload(tx))]);
}

export function sigHash(tx) {
  const elided = { ...tx, signatures: tx.signatures.map((s) => ((s.msg || '0x') === '0x' ? { ...s, signature: '0x' } : s)) };
  return keccak256(raw(elided));
}

export function txHash(tx) {
  return keccak256(raw(tx));
}

/** The JSON shape the sidecar's eth_sendFrameTransaction takes. */
export function wire(tx) {
  return {
    chainId: q(tx.chainId),
    nonceKeys: tx.nonceKeys.map(q),
    nonceSeq: q(tx.nonceSeq),
    sender: getAddress(tx.sender),
    frames: tx.frames.map((f) => ({
      mode: f.mode, flags: f.flags, target: f.target ? getAddress(f.target) : null,
      limits: { execution: q(f.execution), state: q(f.state || 0) }, value: q(f.value || 0), data: f.data || '0x',
    })),
    signatures: tx.signatures.map((s) => ({ scheme: s.scheme, signer: s.signer || '0x', msg: s.msg || '0x',
      signature: hexlify(s.signature || '0x') })),
    fees: { maxPriorityFeePerGas: q(tx.maxPriorityFeePerGas), maxFeePerGas: q(tx.maxFeePerGas),
      maxFeePerBlobGas: q(tx.maxFeePerBlobGas || 0) },
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
}

/** One-time key `leaf` of key epoch `epoch` <-> its EIP-8250 nonce key (key 0 is the ordinary nonce). */
export function frameNonceKey(epoch, leaf) {
  return ((BigInt(epoch) << 32n) | BigInt(leaf)) + 1n;
}
