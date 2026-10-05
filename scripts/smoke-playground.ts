// Runs turbine-cli against Turbine's live playground and checks each answer is a success document:
// the read-only commands, then, when a wallet exists, dry runs of an order and a ladder. Nothing is
// signed or sent, and no password is asked for. Run with `npm run smoke:playground` (it builds first).
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

type Ran = { code: number; stdout: string };
type Step = { name: string; args: string[]; needsWallet: boolean };
type SmokeDeps = {
  run: (args: string[]) => Promise<Ran>;
  log: (line: string) => void;
};

const BASE = ["--network", "playground", "--json", "--no-motion"];
const STEPS: readonly Step[] = [
  { name: "config", args: ["config", ...BASE], needsWallet: false },
  { name: "tokens", args: ["tokens", ...BASE], needsWallet: false },
  {
    name: "quote",
    args: ["quote", "1", "WETH", "USDC", "--spread", "20", ...BASE],
    needsWallet: false,
  },
  {
    name: "order place (dry run)",
    args: [
      "order",
      "place",
      "1",
      "WETH",
      "--for",
      "USDC",
      "--spread",
      "20",
      "--ttl",
      "1h",
      "--dry-run",
      ...BASE,
    ],
    needsWallet: true,
  },
  {
    name: "ladder (dry run)",
    args: [
      "ladder",
      "1",
      "WETH",
      "--for",
      "USDC",
      "--levels",
      "3",
      "--from",
      "0",
      "--to",
      "20",
      "--ttl",
      "1h",
      "--dry-run",
      ...BASE,
    ],
    needsWallet: true,
  },
];
const MAIN = fileURLToPath(new URL("../dist/main.mjs", import.meta.url));

function parse(stdout: string): { ok: boolean; data?: unknown; code?: string } {
  try {
    const doc = JSON.parse(stdout) as {
      ok?: boolean;
      data?: unknown;
      error?: { code?: string };
    };
    return { ok: doc.ok === true, data: doc.data, code: doc.error?.code };
  } catch {
    return { ok: false, code: "NOT_JSON" };
  }
}

async function runSmoke(deps: SmokeDeps): Promise<boolean> {
  let passed = true;
  let hasWallet = false;
  for (const step of STEPS) {
    if (step.needsWallet && !hasWallet) {
      deps.log(`- ${step.name}: skipped (no wallet; turbine wallet new)`);
      continue;
    }
    const ran = await deps.run(step.args);
    const doc = parse(ran.stdout);
    if (!doc.ok || ran.code !== 0) {
      passed = false;
      deps.log(`✗ ${step.name}: ${doc.code ?? `exit ${ran.code}`}`);
      continue;
    }
    if (step.args[0] === "config")
      hasWallet =
        (doc.data as { wallet?: unknown } | undefined)?.wallet != null;
    deps.log(`✓ ${step.name}`);
  }
  return passed;
}

function runCli(args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(process.execPath, [MAIN, ...args], (error, stdout) => {
      const code = error
        ? typeof error.code === "number"
          ? error.code
          : 1
        : 0;
      resolve({ code, stdout });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const passed = await runSmoke({
    run: runCli,
    log: (line) => console.log(line),
  });
  process.exitCode = passed ? 0 : 1;
}

export { runSmoke, STEPS };
