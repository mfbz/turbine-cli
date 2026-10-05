const MASK = "[redacted]";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes every secret from text, matching it with or without 0x and in any case. */
function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    const bare = secret.replace(/^0x/i, "");
    if (bare.length === 0) continue;
    out = out.replace(new RegExp(`(?:0x)?${escape(bare)}`, "gi"), MASK);
  }
  return out;
}

export { redact };
