// QRAC authorization encoding v1. Must match QRACAccount.authorizationMessage() byte for byte
// (also checked against tools/qrac/authorization.py in test.html, and against the live contract
// before every signature in the dApp).
//
//   message = abi.encode(DOMAIN, chainId, account, epoch, nonce, leaf, kind,
//                        allowedSubmitter, validAfter, validUntil, payload)

import { AbiCoder, keccak256, toUtf8Bytes, ZeroAddress } from './eth.js';

export const DOMAIN = keccak256(toUtf8Bytes('QRAC.Authorization.v1'));
export const KIND = { EXECUTE: 1, ROTATE: 2, CANCEL: 3 };
export const KIND_NAME = { 1: 'EXECUTE', 2: 'ROTATE', 3: 'CANCEL' };
export const HEADER_TUPLE = 'tuple(uint64 epoch,uint64 nonce,uint8 kind,address allowedSubmitter,uint64 validAfter,uint64 validUntil)';

const coder = AbiCoder.defaultAbiCoder();

/** calls: [{ target, value (bigint|string), data (hex), checkReturn (bool) }] */
export function executePayload(calls) {
  return coder.encode(
    ['tuple(address,uint256,bytes,bool)[]'],
    [calls.map((c) => [c.target, BigInt(c.value), c.data || '0x', Boolean(c.checkReturn)])],
  );
}

export function decodeExecutePayload(payload) {
  const [calls] = coder.decode(['tuple(address,uint256,bytes,bool)[]'], payload);
  return calls.map((c) => ({ target: c[0], value: c[1], data: c[2], checkReturn: c[3] }));
}

export function rotatePayload(newPublicKey, nextEpoch) {
  return coder.encode(['bytes', 'uint64'], [newPublicKey, BigInt(nextEpoch)]);
}

export function headerTuple(h) {
  return [BigInt(h.epoch), BigInt(h.nonce), Number(h.kind), h.allowedSubmitter || ZeroAddress,
    BigInt(h.validAfter || 0), BigInt(h.validUntil || 0)];
}

export function authorizationMessage(chainId, account, header, leaf, payload) {
  const t = headerTuple(header);
  return coder.encode(
    ['bytes32', 'uint256', 'address', 'uint64', 'uint64', 'uint32', 'uint8', 'address', 'uint64', 'uint64', 'bytes'],
    [DOMAIN, BigInt(chainId), account, t[0], t[1], leaf, t[2], t[3], t[4], t[5], payload],
  );
}
