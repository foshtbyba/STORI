/**
 * Parser for the format the team already writes by hand:
 *
 *   sko 30814 - 20924 + 21909
 *   nomad 41200 - 27400 + 28600
 *   luna 24600 - 16000
 *
 * The third number is the top-up *including* commission. When it is missing we
 * gross the spend up with the payment method's rate instead and flag the row so
 * the person importing can check it.
 */
import { grossUp } from './money';

export type ParsedLine = {
  raw: string;
  handle: string;
  revenueCents: number;
  spendNetCents: number;
  spendGrossCents: number;
  /** True when the gross was computed rather than read from the line. */
  grossDerived: boolean;
  profitCents: number;
  error?: string;
};

const NUMBER = String.raw`-?[\d\s.,]+`;
const LINE = new RegExp(
  String.raw`^\s*([\p{L}\w][\p{L}\w.\-_]*)\s+(${NUMBER}?)\s*[-−–]\s*(${NUMBER}?)(?:\s*\+\s*(${NUMBER}?))?\s*(?:=.*)?$`,
  'iu',
);

function toCents(token: string): number | null {
  const cleaned = token.replace(/[\s ]/g, '').replace(',', '.');
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function parseImport(text: string, commissionBps: number): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map<ParsedLine>((raw) => {
      const match = raw.match(LINE);
      const empty: ParsedLine = {
        raw, handle: '', revenueCents: 0, spendNetCents: 0, spendGrossCents: 0,
        grossDerived: false, profitCents: 0,
      };
      if (!match) return { ...empty, error: 'не разобрана' };

      const revenue = toCents(match[2] ?? '');
      const spend = toCents(match[3] ?? '');
      if (revenue === null || spend === null) return { ...empty, handle: match[1], error: 'не число' };

      const declaredGross = match[4] ? toCents(match[4]) : null;
      const grossDerived = declaredGross === null;
      const spendGrossCents = declaredGross ?? grossUp(spend, commissionBps);

      return {
        raw,
        handle: match[1].toLowerCase(),
        revenueCents: revenue,
        spendNetCents: spend,
        spendGrossCents,
        grossDerived,
        profitCents: revenue - spendGrossCents,
      };
    });
}

/** The commission a line implies, in basis points — used to flag odd rates. */
export function impliedBps(line: ParsedLine) {
  if (!line.spendNetCents) return null;
  return Math.round((line.spendGrossCents / line.spendNetCents - 1) * 10_000);
}
