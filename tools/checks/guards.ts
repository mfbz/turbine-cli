// The guards every change must pass, whoever writes it (people or coding agents): no secrets, no
// personal paths, no AI tool credited as an author, no oversized files. The patterns are written so
// they never match their own source.

type Finding = { rule: string; match: string };

// A key-like name, then `=` or `:`, then 64 hex digits. A bare 64-hex string is not flagged on its
// own: transaction hashes and order ids look exactly the same, and this CLI prints both.
const KEY_NAME = String.raw`(?:(?:private|priv|signer|signing|wallet|secret)[_-]?key|\bpk)`;
const ETH_KEY = new RegExp(
  String.raw`${KEY_NAME}["']?\s*[:=]\s*["']?(?:0x)?[0-9a-fA-F]{64}\b`,
  "i"
);
// A seed phrase: a mnemonic-like name, then 12 to 24 lowercase words.
const SEED_PHRASE =
  /(?:mnemonic|seed[_ -]?phrase)["']?\s*[:=]\s*["']?(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/i;
const SECRETS: ReadonlyArray<[string, RegExp]> = [
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Ethereum private key", ETH_KEY],
  ["seed phrase", SEED_PHRASE],
  ["OpenAI or Anthropic key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/],
  [
    "GitHub token",
    /\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/,
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
];
const ATTRIBUTION =
  /Co-Authored-By:[ \t]*[A-Za-z]|noreply@anthropic\.com|Generated with \[?Claude/i;

/** 1 MB: a bigger file is almost always a build output or a recording that belongs elsewhere. */
const MAX_FILE_BYTES = 1024 * 1024;
// Files over the limit kept on purpose, by repo path. None yet.
const BIG_ON_PURPOSE = new Set<string>();

function findSecrets(text: string): Finding[] {
  return SECRETS.flatMap(([rule, pattern]) => {
    const found = pattern.exec(text);
    // Only the start of a match: a report must not repeat the secret.
    return found ? [{ rule, match: `${found[0].slice(0, 8)}…` }] : [];
  });
}

function findAttribution(text: string): Finding[] {
  const found = ATTRIBUTION.exec(text);
  return found
    ? [{ rule: "AI tool credited as an author", match: found[0] }]
    : [];
}

function findHomePath(text: string, home: string): Finding[] {
  return home.length > 1 && text.includes(home)
    ? [{ rule: "this computer's home folder", match: home }]
    : [];
}

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

/** Every guard on one file about to be committed: what's wrong with it, for people to read. */
function checkFile(path: string, bytes: Buffer, home: string): string[] {
  const problems: string[] = [];
  if (bytes.length > MAX_FILE_BYTES && !BIG_ON_PURPOSE.has(path))
    problems.push(`${path}: over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  if (isBinary(bytes)) return problems;
  const text = bytes.toString("utf8");
  for (const f of [
    ...findSecrets(text),
    ...findHomePath(text, home),
    ...findAttribution(text),
  ])
    problems.push(`${path}: ${f.rule} (${f.match})`);
  return problems;
}

/** A commit message: no AI tool as an author, and no secret pasted into it. */
function checkMessage(text: string): string[] {
  return [...findAttribution(text), ...findSecrets(text)].map(
    (f) => `commit message: ${f.rule} (${f.match})`
  );
}

export {
  BIG_ON_PURPOSE,
  MAX_FILE_BYTES,
  checkFile,
  checkMessage,
  findAttribution,
  findHomePath,
  findSecrets,
  isBinary,
};
export type { Finding };
