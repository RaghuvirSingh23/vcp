/**
 * Build the list of symbols to scan.
 *
 *   npm run universe -- --market us      all NASDAQ/NYSE/AMEX common stocks that pass a liquidity screen
 *   npm run universe -- --market in      Nifty Total Market (750 names)
 *
 * The lists are today's listings. Stocks that were delisted or acquired are absent,
 * which makes any backtest over this universe survivorship-biased.
 */
import type { Market, UniverseEntry } from "../engine/types";
import { args, markets, pool, universePath, writeJson } from "./store";
import { fetchLiquidity } from "./yahoo";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function text(urls: string[]): Promise<string> {
  let err: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const t = await res.text();
      if (t.trimStart().startsWith("<")) throw new Error(`${url}: got HTML, not a list`);
      return t;
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

/** Minimal CSV reader: handles quoted fields with commas. */
function csv(src: string, sep = ","): string[][] {
  const rows: string[][] = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) row.push(cur), (cur = "");
      else cur += ch;
    }
    row.push(cur);
    rows.push(row.map((x) => x.trim()));
  }
  return rows;
}

// Securities that trade on an exchange but are not common stock.
const NOT_COMMON =
  /\b(warrants?|units?|rights?|preferred|preference|depositary shares? (each )?representing .*(preferred|interest in)|notes?|debentures?|bonds?|trust preferred|contingent value|subordinated|%)\b/i;

async function usListed(): Promise<UniverseEntry[]> {
  const [nas, oth, spx] = await Promise.all([
    text(["https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"]),
    text(["https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"]),
    text(["https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"]).catch(() => ""),
  ]);
  const sector = new Map<string, string>();
  for (const r of csv(spx).slice(1)) sector.set(r[0], r[2]);

  const out = new Map<string, UniverseEntry>();
  const add = (sym: string, name: string, etf: string, test: string) => {
    if (etf !== "N" || test !== "N") return;
    if (!/^[A-Z]{1,5}(\.[AB])?$/.test(sym)) return; // drops preferreds ($), units (.U), warrants (.WS)
    if (NOT_COMMON.test(name)) return;
    const clean = name
      .replace(/\s+-\s+.*$/, "")
      .replace(/,? (Common Stock|Common Shares|Ordinary Shares|Class [AB] .*|American Depositary .*)$/i, "")
      .trim();
    out.set(sym, { symbol: sym, yahoo: sym.replace(".", "-"), name: clean || sym, sector: sector.get(sym) });
  };
  // Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
  for (const r of csv(nas, "|").slice(1)) if (r.length >= 7) add(r[0], r[1], r[6], r[3]);
  // ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
  for (const r of csv(oth, "|").slice(1)) if (r.length >= 7) add(r[0], r[1], r[4], r[6]);
  return [...out.values()];
}

async function inListed(): Promise<UniverseEntry[]> {
  const src = await text([
    "https://www.niftyindices.com/IndexConstituent/ind_niftytotalmarket_list.csv",
    "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv",
    "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv",
    "https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
  ]);
  // Company Name,Industry,Symbol,Series,ISIN Code
  return csv(src)
    .slice(1)
    .filter((r) => r.length >= 4 && r[2])
    .map((r) => ({ symbol: r[2], yahoo: r[2] + ".NS", name: r[0].replace(/ Ltd\.?$/i, ""), sector: r[1] }));
}

async function build(market: Market, a: Record<string, string>) {
  let list = market === "us" ? await usListed() : await inListed();
  console.log(`${market}: ${list.length} listed`);
  if (market === "us" && a.screen !== "false") {
    // Price and traded-value floor. Thin or sub-$5 names do not form readable bases.
    const minPrice = Number(a["min-price"] ?? 5);
    const minValue = Number(a["min-value"] ?? 5e6);
    let done = 0;
    const liq = await pool(list, 10, async (e) => {
      const q = await fetchLiquidity(e.yahoo).catch(() => null);
      if (++done % 500 === 0) console.log(`  screened ${done}/${list.length}`);
      return q;
    });
    list = list.filter((_, i) => {
      const q = liq[i];
      return q && q.bars >= 20 && q.close >= minPrice && q.value >= minValue;
    });
    console.log(`${market}: ${list.length} pass price ≥ ${minPrice} and median traded value ≥ ${minValue / 1e6}M`);
  }
  list.sort((x, y) => x.symbol.localeCompare(y.symbol));
  writeJson(universePath(market), list);
}

const a = args();
for (const m of markets(a)) await build(m, a);
