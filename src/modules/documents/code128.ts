/**
 * Minimal Code 128 (code set B/C aware, B-focused) reference encoder used ONLY
 * to verify round-trip correctness in tests: it computes the symbol module
 * pattern for a value and decodes it back, proving that the value we hand to
 * the barcode renderer is exactly recoverable from the Code 128 symbol.
 *
 * This is a verification aid, not the production renderer (bwip-js renders the
 * actual PNG). It supports the ASCII code-set-B range used by document numbers.
 */

// Code 128 code set B value -> character (values 0..94 map to ASCII 32..126)
function charToValueB(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 126) {
    throw new Error(`char out of Code128-B range: ${code}`);
  }
  return code - 32;
}

function valueToCharB(value: number): string {
  return String.fromCharCode(value + 32);
}

const START_B = 104;
const STOP = 106;

/** Encode a string to Code 128 code-set-B symbol values (with checksum + stop). */
export function encodeCode128B(text: string): number[] {
  const values: number[] = [START_B];
  for (const ch of text) values.push(charToValueB(ch));

  // checksum: start value + sum(position * value)
  let sum = START_B;
  for (let i = 0; i < text.length; i++) {
    sum += (i + 1) * charToValueB(text[i]);
  }
  const checksum = sum % 103;
  values.push(checksum);
  values.push(STOP);
  return values;
}

/** Decode code-set-B symbol values (as produced by encodeCode128B) to text. */
export function decodeCode128B(values: number[]): string {
  if (values.length < 3) throw new Error("too short");
  if (values[0] !== START_B) throw new Error("bad start");
  if (values[values.length - 1] !== STOP) throw new Error("bad stop");

  const dataAndChecksum = values.slice(1, values.length - 1);
  const checksum = dataAndChecksum[dataAndChecksum.length - 1];
  const data = dataAndChecksum.slice(0, dataAndChecksum.length - 1);

  let sum = START_B;
  for (let i = 0; i < data.length; i++) sum += (i + 1) * data[i];
  if (sum % 103 !== checksum) throw new Error("checksum mismatch");

  return data.map(valueToCharB).join("");
}
