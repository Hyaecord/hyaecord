/**
 * Decodes a creation timestamp out of a Stoat ULID — Stoat's message/user/
 * etc IDs have no separate `timestamp` field in the API (confirmed: the
 * `Message` schema has none, and the OpenAPI spec's `before`/`after`
 * message-query params both require exactly `minLength: 26, maxLength:
 * 26`, the fixed length of a real ULID), so the creation time has to be
 * decoded from the ID itself the same way Stoat's own clients do — not
 * guessed, standard Crockford Base32 ULID timestamp decoding (first 10
 * characters = a 48-bit big-endian millisecond timestamp).
 */
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulidTimestampMs(id: string): number | null {
  if (id.length < 10) return null;
  let ms = 0;
  for (let i = 0; i < 10; i++) {
    const index = CROCKFORD_BASE32.indexOf(id[i]!.toUpperCase());
    if (index === -1) return null;
    ms = ms * 32 + index;
  }
  return ms;
}
