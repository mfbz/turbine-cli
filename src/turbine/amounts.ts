// Token amounts, prices, spreads and durations: exact integer maths on atomic units (no floating
// point), with the conversions a person reads and types.
import { formatUnits, parseUnits } from "viem";

import { CliError } from "../output/errors.ts";

type Ratio = { numerator: bigint; denominator: bigint };

const DECIMAL = /^\d+(?:\.(\d+))?$/;
const DURATION = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
// Turbine's limits for a spread, in basis points (docs: "Market Make").
const MIN_SPREAD = -10_000;
const MAX_SPREAD = 9_999;
// Extra precision for prices before rounding them for display.
const PRICE_SCALE = 36;
// The largest amount a token can hold on Ethereum (uint256).
const MAX_UINT256 = 2n ** 256n - 1n;

/** That text is shaped like an amount; the token's decimals are checked later, by parseAmount. */
function checkAmountFormat(text: string): void {
  if (!DECIMAL.test(text.trim()))
    throw new CliError("AMOUNT_INVALID", { amount: text });
}

/** A positive decimal amount typed by a person, in atomic units of a token with these decimals. */
function parseAmount(text: string, decimals: number): bigint {
  const match = DECIMAL.exec(text.trim());
  if (!match) throw new CliError("AMOUNT_INVALID", { amount: text });
  if ((match[1]?.length ?? 0) > decimals)
    throw new CliError("AMOUNT_TOO_PRECISE", { decimals: String(decimals) });
  const atomic = parseUnits(text.trim(), decimals);
  if (atomic <= 0n || atomic > MAX_UINT256)
    throw new CliError("AMOUNT_INVALID", { amount: text });
  return atomic;
}

/** An atomic amount as a decimal, exact, or rounded to significant digits for a person to read. */
function formatAmount(
  atomic: bigint,
  decimals: number,
  significant?: number,
  // "down" for a floor shown to a person ("at least …"), so it is never more than the real amount.
  rounding: "nearest" | "down" = "nearest"
): string {
  let value = atomic;
  if (significant !== undefined && value > 0n) {
    const drop = value.toString().length - significant;
    if (drop > 0) {
      const factor = 10n ** BigInt(drop);
      const half = rounding === "down" ? 0n : factor / 2n;
      value = ((value + half) / factor) * factor;
    }
  }
  return formatUnits(value, decimals);
}

/** A mid price in atomic units (buy-wei per sell-wei) as buy tokens per sell token. */
function priceOf(
  mid: Ratio,
  sellDecimals: number,
  buyDecimals: number,
  significant = 8
): string {
  const shift = sellDecimals - buyDecimals + PRICE_SCALE;
  const scaled =
    shift >= 0
      ? (mid.numerator * 10n ** BigInt(shift)) / mid.denominator
      : mid.numerator / (mid.denominator * 10n ** BigInt(-shift));
  return formatAmount(scaled, PRICE_SCALE, significant);
}

/** An amount after a spread in basis points: positive takes less than mid, negative asks for more. */
function withSpread(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < MIN_SPREAD || bps > MAX_SPREAD)
    throw new CliError("SPREAD_INVALID");
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

/** A duration such as 90s, 15m, 4h, 2d or 1h30m, in seconds. */
function parseDuration(text: string): number {
  const match = DURATION.exec(text.trim());
  if (
    !text.trim() ||
    !match ||
    match.slice(1).every((part) => part === undefined)
  )
    throw new CliError("DURATION_INVALID", { duration: text });
  const [days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  return (
    (days ?? 0) * 86_400 +
    (hours ?? 0) * 3_600 +
    (minutes ?? 0) * 60 +
    (seconds ?? 0)
  );
}

export {
  checkAmountFormat,
  formatAmount,
  parseAmount,
  parseDuration,
  priceOf,
  withSpread,
};
export type { Ratio };
