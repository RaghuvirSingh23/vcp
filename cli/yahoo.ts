/**
 * Daily bars from Yahoo Finance's chart endpoint. OHLC comes back split-adjusted;
 * we do not apply the dividend adjustment, so prices match what a chart shows.
 */
import type { Bars, Market } from "../engine/types";

// Yahoo answers 429 to a full browser User-Agent that arrives without cookies; the bare token is accepted.
const UA = "Mozilla/5.0";
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NotFound extends Error {}

async function chart(symbol: string, query: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    try {
      const res = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404) throw new NotFound(symbol);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) {
        const msg = json?.chart?.error?.description ?? "empty result";
        if (/No data found|delisted|not found/i.test(msg)) throw new NotFound(symbol);
        throw new Error(msg);
      }
      return r;
    } catch (e) {
      if (e instanceof NotFound) throw e;
      lastErr = e;
      await sleep(600 * 2 ** attempt + Math.random() * 400);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Last close and median daily traded value over the past three months. For liquidity screening. */
export async function fetchLiquidity(yahoo: string): Promise<{ close: number; value: number; bars: number } | null> {
  let r: any;
  try {
    r = await chart(yahoo, "range=3mo&interval=1d");
  } catch (e) {
    if (e instanceof NotFound) return null;
    throw e;
  }
  const q = r.indicators?.quote?.[0] ?? {};
  const vals: number[] = [];
  let close = NaN;
  for (let i = 0; i < (r.timestamp?.length ?? 0); i++) {
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (c > 0) {
      close = c;
      vals.push(c * (v ?? 0));
    }
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return { close, value: vals[Math.floor(vals.length / 2)], bars: vals.length };
}

/** Exchange-local calendar date of a bar timestamp, as YYYYMMDD. */
function localDate(ts: number, gmtoffset: number): number {
  const dt = new Date((ts + gmtoffset) * 1000);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

export interface FetchOptions {
  /** YYYY-MM-DD; default 2005-01-01. */
  since?: string;
}

export async function fetchBars(
  yahoo: string,
  symbol: string,
  market: Market,
  name: string,
  opt: FetchOptions = {},
): Promise<Bars> {
  const p1 = Math.floor(Date.parse((opt.since ?? "2005-01-01") + "T00:00:00Z") / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const r = await chart(yahoo, `period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits&includePrePost=false`);
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const meta = r.meta ?? {};
  const off: number = meta.gmtoffset ?? 0;
  const out: Bars = {
    symbol,
    market,
    name: name || meta.longName || meta.shortName || symbol,
    currency: meta.currency ?? "",
    exchange: meta.fullExchangeName ?? meta.exchangeName,
    d: [],
    o: [],
    h: [],
    l: [],
    c: [],
    v: [],
    fetchedAt: new Date().toISOString(),
    warnings: [],
  };
  let dropped = 0;
  for (let i = 0; i < ts.length; i++) {
    let o = q.open?.[i];
    let h = q.high?.[i];
    let l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (!(c > 0) || !(h > 0) || !(l > 0)) {
      dropped++;
      continue;
    }
    if (!(o > 0)) o = c;
    // Vendor rows are occasionally inconsistent; the bar must contain its own open and close.
    h = Math.max(h, o, c);
    l = Math.min(l, o, c);
    const date = localDate(ts[i], off);
    const n = out.d.length;
    if (n && out.d[n - 1] === date) {
      // A second row for the same session (the live bar). Keep the later one.
      out.o[n - 1] = r4(o);
      out.h[n - 1] = r4(h);
      out.l[n - 1] = r4(l);
      out.c[n - 1] = r4(c);
      out.v[n - 1] = Math.round(v ?? 0);
      continue;
    }
    out.d.push(date);
    out.o.push(r4(o));
    out.h.push(r4(h));
    out.l.push(r4(l));
    out.c.push(r4(c));
    out.v.push(Math.round(v ?? 0));
  }
  // Drop a session that is still trading: its bar is not final.
  const reg = meta.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  if (reg && out.d.length && now < reg.end && out.d[out.d.length - 1] === localDate(reg.start, off)) {
    for (const k of ["d", "o", "h", "l", "c", "v"] as const) out[k].pop();
    out.warnings!.push("dropped the live session bar");
  }
  if (dropped > ts.length * 0.02 && dropped > 5) out.warnings!.push(`${dropped} rows without prices dropped`);
  sanitize(out);
  if (!out.warnings!.length) delete out.warnings;
  return out;
}

/**
 * Guard against the two vendor faults that fabricate patterns:
 * an unadjusted corporate action (shows as one enormous overnight gap) and
 * stretches of sessions with no trading. History before the last such
 * discontinuity is cut, so no base can span it.
 */
function sanitize(b: Bars) {
  let cut = -1;
  for (let i = 1; i < b.c.length; i++) {
    const g = b.o[i] / b.c[i - 1];
    // No exchange we cover lets an ordinary stock gap this far and keep trading as the same instrument often enough to matter.
    if (g < 0.45 || g > 2.2) cut = i;
  }
  if (cut > 0) {
    b.warnings!.push(`price discontinuity on ${b.d[cut]}; earlier history cut`);
    for (const k of ["d", "o", "h", "l", "c", "v"] as const) b[k].splice(0, cut);
  }
}
