// turbine order watch: follows one order until it is done. Three ways to show it: a full-screen live
// view in a terminal, one plain line per change when piped, and one JSON object per change (NDJSON)
// with --json, ending with a "final" event. Everything it needs comes in as parameters, so the loop is
// tested without a network, a clock or a keyboard.
import { toErrorReport } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import { humanDuration, statusWord } from "./orders.ts";
import type { OrderReport } from "./orders.ts";

type Mode = "json" | "lines" | "screen";
type Outcome =
  | { kind: "done"; status: string }
  | { kind: "quit" }
  | { kind: "cancel" }
  | { kind: "interrupted" };
type WatchDeps = {
  fetchState: () => Promise<OrderReport>;
  fetchMid: () => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  // Keys as they are pressed (screen mode); returns a function that stops listening.
  onKey?: (handler: (key: string) => void) => () => void;
  mode: Mode;
  write: (text: string) => void;
  theme: Theme;
  width: () => number;
  now: () => number;
};

// Turbine settles in batches about every block; polling faster would only spend rate limit.
const POLL_MS = 3_000;
// The mid moves slower than an order's state matters; every other poll is enough.
const MID_EVERY = 2;
const FINISHED = new Set([
  "Filled",
  "Expired",
  "Canceled",
  "Invalid",
  "Incompatible",
]);
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const HOME_AND_CLEAR = "\u001b[H\u001b[2J";
const BAR = 24;
// A watch can run for hours: ride out a few transient failures before giving up.
const MAX_RETRIES = 5;
const KEYS: Readonly<Record<string, Outcome>> = {
  q: { kind: "quit" },
  Q: { kind: "quit" },
  c: { kind: "cancel" },
  C: { kind: "cancel" },
  "\u0003": { kind: "interrupted" },
};

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function bar(percent: string | null, theme: Theme, width: number): string {
  const share = Math.min(100, Math.max(0, Number(percent ?? 0)));
  const cells = Math.max(8, Math.min(BAR, width - 40));
  const full = Math.round((share / 100) * cells);
  return `${theme.success("█".repeat(full))}${theme.dim("░".repeat(cells - full))} ${share}%`;
}

function renderWatch(
  o: OrderReport,
  mid: string | null,
  theme: Theme,
  width: number,
  frame: number
): string {
  const sell = o.sell?.symbol ?? "?";
  const buy = o.buy?.symbol ?? "?";
  const spinning = FINISHED.has(o.status)
    ? "•"
    : (SPINNER[frame % SPINNER.length] ?? "•");
  const rows: Array<[string, string]> = [
    ["status", `${statusWord(o.status, theme)} ${theme.accent(spinning)}`],
    [
      "filled",
      `${bar(o.filledPercent, theme, width)}  ${o.sold?.amount ?? "0"} ${sell} sold for ${o.bought?.amount ?? "0"} ${buy}`,
    ],
    [
      "price",
      `${mid === null ? theme.dim("mid unknown") : `mid ${mid}`} · ${o.limitPrice ? `limit ${o.limitPrice}` : theme.warning("no limit")} ${theme.dim(`${buy} per ${sell}`)}`,
    ],
    [
      "time",
      o.secondsLeft === null
        ? theme.dim("unknown")
        : `${humanDuration(o.secondsLeft)} left ${theme.dim(`(ends ${o.endsAt ?? "?"})`)}`,
    ],
  ];
  const fills = o.fills
    .slice(-5)
    .map(
      (f) =>
        `  ${theme.dim(f.clearedAt.slice(11, 16))}  ${f.sold.amount} ${sell} → ${f.bought.amount} ${buy}${f.price ? theme.dim(` at ${f.price}`) : ""}`
    );
  const lines = [
    `${theme.accent("▌▌▐▐")} ${theme.bold("Turbine")} ${theme.dim(`· watching ${shortHash(o.hash)}`)}`,
    "",
    ...rows.map(([label, value]) => `  ${theme.dim(label.padEnd(8))}${value}`),
    ...(fills.length ? ["", `  ${theme.dim("fills")}`, ...fills] : []),
    "",
    theme.dim("  q quit · c cancel"),
  ];
  // Never wider than the terminal: a wrapped line would break the redraw. A terminal that reports no
  // width (0) gets the usual 80.
  const columns = width > 0 ? width : 80;
  return lines.map((line) => truncate(line, columns)).join("\n");
}

// Cuts by visible characters, keeping colour codes intact.
function truncate(line: string, width: number): string {
  let visible = 0;
  let out = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\u001b") {
      const end = line.indexOf("m", i);
      out += line.slice(i, end + 1);
      i = end;
      continue;
    }
    if (visible >= width) continue;
    out += line[i];
    visible++;
  }
  return out;
}

function line(o: OrderReport, mid: string | null, theme: Theme): string {
  const time = new Date().toISOString().slice(11, 19);
  return `${theme.dim(time)} ${statusWord(o.status, theme)} ${o.filledPercent ?? "?"}% filled · mid ${mid ?? "?"}${o.secondsLeft === null ? "" : ` · ${humanDuration(o.secondsLeft)} left`}\n`;
}

async function watchOrder(deps: WatchDeps): Promise<Outcome> {
  // A key ends the watch at once, even while a request is still in flight.
  let stopListening = () => {};
  const pressed = new Promise<Outcome>((resolve) => {
    stopListening =
      deps.onKey?.((key) => {
        const outcome = KEYS[key];
        if (outcome) resolve(outcome);
      }) ?? stopListening;
  });
  type Raced<T> = { kind: "value"; value: T } | { kind: "key" };
  let keyed: Outcome | undefined;
  const orKey = <T>(work: Promise<T>): Promise<Raced<T>> =>
    Promise.race([
      work.then((value): Raced<T> => ({ kind: "value", value })),
      pressed.then((outcome): Raced<T> => {
        keyed = outcome;
        return { kind: "key" };
      }),
    ]);

  try {
    let mid: string | null = null;
    let previous = "";
    let failures = 0;
    for (let tick = 0; ; tick++) {
      let order: OrderReport;
      try {
        const fetched = await orKey(deps.fetchState());
        if (fetched.kind === "key") return keyed ?? { kind: "quit" };
        order = fetched.value;
        failures = 0;
      } catch (error) {
        failures++;
        if (!toErrorReport(error).retryable || failures > MAX_RETRIES)
          throw error;
        const waited = await orKey(deps.sleep(POLL_MS * failures));
        if (waited.kind === "key") return keyed ?? { kind: "quit" };
        continue;
      }
      if (tick % MID_EVERY === 0) {
        const fetched = await orKey(deps.fetchMid().catch(() => mid));
        if (fetched.kind === "key") return keyed ?? { kind: "quit" };
        mid = fetched.value;
      }
      const done = FINISHED.has(order.status);
      // What counts as a change: everything but the countdown.
      const signature = JSON.stringify([{ ...order, secondsLeft: null }, mid]);
      const changed = signature !== previous;
      previous = signature;

      if (deps.mode === "screen") {
        deps.write(
          `${HOME_AND_CLEAR}${renderWatch(order, mid, deps.theme, deps.width(), tick)}\n`
        );
      } else if (changed || done) {
        if (deps.mode === "json")
          deps.write(
            `${JSON.stringify({ type: done ? "final" : "state", order, mid })}\n`
          );
        else deps.write(line(order, mid, deps.theme));
      }
      if (done) return { kind: "done", status: order.status };

      const waited = await orKey(deps.sleep(POLL_MS));
      if (waited.kind === "key") return keyed ?? { kind: "quit" };
    }
  } finally {
    stopListening();
  }
}

export { renderWatch, watchOrder };
export type { Mode, Outcome };
