const MASK = "[redacted]";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A hex secret (a private key) also appears as a decimal number in some library errors.
function forms(secret: string): string[] {
  const bare = secret.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(bare)) return [secret];
  return [`(?:0x)?${bare}`, BigInt(`0x${bare}`).toString()];
}

/** Removes every known secret from text, in any case, with or without 0x, and in decimal. */
function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    for (const form of forms(secret)) {
      const pattern = form.startsWith("(?:0x)?") ? form : escape(form);
      out = out.replace(new RegExp(pattern, "gi"), MASK);
    }
  }
  return out;
}

/** The same, on every string inside a value, so JSON is redacted before it is written, never after. */
function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redact(value, secrets);
  if (typeof value === "bigint") return redact(value.toString(), secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactValue(v, secrets)])
    );
  }
  return value;
}

export { redact, redactValue };
