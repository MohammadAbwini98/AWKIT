import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 128 bits of randomness, encoded without ambiguous 0/O/1/I characters and grouped for copying. */
export function generateRecoveryCode(bytes: () => Buffer = () => randomBytes(16)): string {
  const input = bytes();
  if (input.length < 16) throw new Error("Recovery-code entropy source returned fewer than 16 bytes.");
  let bits = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of input.subarray(0, 16)) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += ALPHABET[(bits >>> bitCount) & 31];
    }
  }
  if (bitCount > 0) encoded += ALPHABET[(bits << (5 - bitCount)) & 31];
  return encoded.match(/.{1,4}/g)!.join("-");
}

export function normalizeRecoveryCode(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}
