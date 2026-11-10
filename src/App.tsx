import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bars, Market } from "../engine/types";
import { indicators } from "../engine/indicators";
import { analyze } from "../engine/vcp";
import { ChartPane } from "./components/ChartPane";
import { ScanList } from "./components/ScanList";
import { Evidence } from "./components/Evidence";
import { BacktestSummary, NO_FILTERS, Outcome, SignalList, applyFilters, type Filters } from "./components/Backtest";
import { DARK, LIGHT, fmtDate, fmtPct, fmtPrice } from "./chart/theme";
import type { ChartInput, ChartOptions } from "./chart/Chart";
import {
  BENCH_NAME,
  MARKET_LABEL,
  fileKey,
  getBacktest,
  getBars,
  getBench,
  getScan,
  indexAt,
  isoDate,
  type BacktestFile,
  type ScanFile,
} from "./data";

type View = "scan" | "backtest";

interface Route {
  view: View;
  market: Market;
  symbol: string | null;
  /** YYYYMMDD the chart is read on; null = the latest bar. */
  date: number | null;
}

function parseHash(): Route {
  const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const view: View = p[0] === "backtest" ? "backtest" : "scan";
  if (p[0] === "scan" || p[0] === "backtest") p.shift();
  const market: Market = p[0] === "in" ? "in" : "us";
  return { view, market, symbol: p[1] ? decodeURIComponent(p[1]) : null, date: p[2] && /^\d{8}$/.test(p[2]) ? Number(p[2]) : null };
}
const toHash = (r: Route) =>
  `#/${r.view}/${r.market}${r.symbol ? "/" + encodeURIComponent(r.symbol) : ""}${r.symbol && r.date ? "/" + r.date : ""}`;

const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function App() {
  const [route, setRouteState] = useState<Route>(parseHash);
  const [scan, setScan] = useState<ScanFile | null | undefined>(undefined);
  const [bt, setBt] = useState<BacktestFile | null | undefined>(undefined);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [bars, setBars] = useState<Bars | null | undefined>(undefined);
  const [bench, setBench] = useState<Bars | null>(null);
  const [showFuture, setShowFuture] = useState(true);
  const [dark, setDark] = useState(() => (localStorage.getItem("theme") ?? (prefersDark() ? "dark" : "light")) === "dark");
  const [log, setLog] = useState(true);
  const [candles, setCandles] = useState(false);
  const [swings, setSwings] = useState(false);

  const setRoute = useCallback((r: Route) => {
    setRouteState(r);
    const h = toHash(r);
    if (location.hash !== h) history.replaceState(null, "", h);
  }, []);

  useEffect(() => {
    const on = () => setRouteState(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  // Scan + benchmark for the market.
  useEffect(() => {
    let live = true;
    setScan(undefined);
    getScan(route.market).then((s) => live && setScan(s));
    getBench(route.market).then((b) => live && setBench(b));
    return () => {
      live = false;
    };
  }, [route.market]);

  // The backtest file is large; load it only when its view is opened.
  useEffect(() => {
    if (route.view !== "backtest") return;
    let live = true;
    setBt(undefined);
    getBacktest(route.market).then((b) => live && setBt(b));
    return () => {
      live = false;
    };
  }, [route.view, route.market]);

  // Scanner: start on the best row of the scan.
  useEffect(() => {
    if (route.view === "scan" && !route.symbol && scan?.rows.length) setRoute({ ...route, symbol: scan.rows[0].symbol });
  }, [scan, route, setRoute]);

  // Bars for the selected symbol.
  useEffect(() => {
    if (!route.symbol) {
      setBars(undefined);
      return;
    }
    let live = true;
    setBars(undefined);
    getBars(route.market, fileKey(route.symbol)).then((b) => live && setBars(b));
    return () => {
      live = false;
    };
  }, [route.market, route.symbol]);

  const signals = useMemo(() => (bt ? applyFilters(bt, filters) : []), [bt, filters]);
  const signal = useMemo(
    () => (route.view === "backtest" && bt && route.symbol ? (bt.signals.find((s) => s.symbol === route.symbol && s.setupDate === route.date) ?? null) : null),
    [route, bt],
  );

  const ind = useMemo(() => (bars ? indicators(bars, bench ?? undefined) : null), [bars, bench]);
  const asOf = useMemo(() => {
    if (!bars) return -1;
    if (route.date === null) return bars.d.length - 1;
    return Math.max(0, indexAt(bars, route.date));
  }, [bars, route.date]);
  const analysis = useMemo(() => (bars && ind && asOf >= 0 ? analyze(bars, ind, asOf) : null), [bars, ind, asOf]);

  const step = useCallback(
    (delta: number) => {
      if (!bars) return;
      const i = Math.min(bars.d.length - 1, Math.max(40, asOf + delta));
      setRoute({ ...route, date: i === bars.d.length - 1 ? null : bars.d[i] });
    },
    [bars, asOf, route, setRoute],
  );

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
      if (e.key === "ArrowLeft") step(e.shiftKey ? -5 : -1), e.preventDefault();
      if (e.key === "ArrowRight") step(e.shiftKey ? 5 : 1), e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [step]);

  const options: ChartOptions = useMemo(() => ({ log, candles, swings, theme: dark ? DARK : LIGHT }), [log, candles, swings, dark]);
  const input: ChartInput | null = useMemo(() => {
    if (!bars || !ind || asOf < 0) return null;
    // On a backtest signal, mark the trade exactly as it was scored.
    const trade =
      signal && bars.d[asOf] === signal.setupDate
        ? {
            entryIdx: indexAt(bars, signal.date),
            entry: signal.entry,
            stop: signal.stop,
            exitIdx: signal.reason === "open" ? undefined : indexAt(bars, signal.exitDate),
            exit: signal.reason === "open" ? undefined : signal.exit,
            label: `${signal.reason === "stop" ? "stopped" : "sold"} ${fmtPrice(signal.exit)} · ${signal.r >= 0 ? "+" : "−"}${Math.abs(signal.r).toFixed(1)}R`,
          }
        : undefined;
    return {
      bars,
      ind,
      analysis,
      asOf,
      showFuture,
      trade,
      benchName: bench ? (BENCH_NAME[bench.symbol] ?? bench.symbol) : undefined,
    };
  }, [bars, ind, analysis, asOf, showFuture, bench, signal]);

  const row = scan?.rows.find((r) => r.symbol === route.symbol);
  const chg = bars && asOf > 0 ? bars.c[asOf] / bars.c[asOf - 1] - 1 : 0;
  const atLatest = bars ? asOf === bars.d.length - 1 : true;
  const showSummary = route.view === "backtest" && !route.symbol;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">VCP</div>
        <div className="seg" role="tablist" aria-label="View">
          {(["scan", "backtest"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={route.view === v} onClick={() => setRoute({ view: v, market: route.market, symbol: null, date: null })}>
              {v === "scan" ? "Scanner" : "Backtest"}
            </button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="Market">
          {(["us", "in"] as Market[]).map((m) => (
            <button key={m} role="tab" aria-selected={route.market === m} onClick={() => setRoute({ view: route.view, market: m, symbol: null, date: null })}>
              {MARKET_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="top-meta">
          {route.view === "scan"
            ? scan
              ? `Scan of ${fmtDate(scan.date)} · ${scan.rows.length.toLocaleString()} stocks`
              : scan === null
                ? "No scan yet"
                : ""
            : bt
              ? `${bt.signals.length.toLocaleString()} breakouts · ${fmtDate(bt.from)} to ${fmtDate(bt.to)}`
              : bt === null
                ? "No backtest yet"
                : ""}
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => setDark(!dark)} aria-label="Toggle theme">
          {dark ? "Light" : "Dark"}
        </button>
      </header>

      <aside className="side">
        {route.view === "scan" ? (
          <ScanList scan={scan} market={route.market} selected={route.symbol} onSelect={(symbol) => setRoute({ ...route, symbol, date: null })} />
        ) : (
          <SignalList
            file={bt}
            filters={filters}
            onFilters={setFilters}
            signals={signals}
            selected={signal}
            onSelect={(s) => setRoute({ ...route, symbol: s ? s.symbol : null, date: s ? s.setupDate : null })}
          />
        )}
      </aside>

      <main className="main">
        {showSummary ? (
          bt ? (
            <BacktestSummary file={bt} signals={signals} />
          ) : (
            <div className="empty">{bt === null ? `No backtest for ${MARKET_LABEL[route.market]} yet. Run: npm run backtest -- --market ${route.market}` : "Loading…"}</div>
          )
        ) : bars && ind ? (
          <>
            <div className="chart-head">
              <div className="title">
                <span className="sym">{bars.symbol}</span>
                <span className="name">{bars.name}</span>
                {row?.sector && <span className="sector">{row.sector}</span>}
              </div>
              <div className="quote">
                <span className="px">{fmtPrice(bars.c[asOf])}</span>
                <span className={chg >= 0 ? "up" : "down"}>{fmtPct(chg, 2)}</span>
              </div>
            </div>
            <div className="toolbar">
              <div className="replay">
                <button className="ghost" onClick={() => step(-5)} title="Back 5 sessions (Shift ←)">
                  «
                </button>
                <button className="ghost" onClick={() => step(-1)} title="Back 1 session (←)">
                  ‹
                </button>
                <input
                  type="date"
                  value={isoDate(bars.d[asOf])}
                  min={isoDate(bars.d[Math.min(40, bars.d.length - 1)])}
                  max={isoDate(bars.d[bars.d.length - 1])}
                  onChange={(e) => {
                    const d = Number(e.target.value.replaceAll("-", ""));
                    if (d) setRoute({ ...route, date: d >= bars.d[bars.d.length - 1] ? null : d });
                  }}
                  aria-label="Read the chart as of"
                />
                <button className="ghost" onClick={() => step(1)} disabled={atLatest} title="Forward 1 session (→)">
                  ›
                </button>
                <button className="ghost" onClick={() => step(5)} disabled={atLatest} title="Forward 5 sessions (Shift →)">
                  »
                </button>
                <button className="ghost" onClick={() => setRoute({ ...route, date: null })} disabled={atLatest}>
                  Latest
                </button>
                {!atLatest && (
                  <label className="check">
                    <input type="checkbox" checked={showFuture} onChange={(e) => setShowFuture(e.target.checked)} />
                    Show what followed
                  </label>
                )}
              </div>
              <div className="spacer" />
              <label className="check">
                <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} />
                Log scale
              </label>
              <label className="check">
                <input type="checkbox" checked={candles} onChange={(e) => setCandles(e.target.checked)} />
                Candles
              </label>
              <label className="check">
                <input type="checkbox" checked={swings} onChange={(e) => setSwings(e.target.checked)} />
                Minor swings
              </label>
            </div>
            <ChartPane input={input} options={options} fitKey={`${route.view}/${route.market}/${route.symbol}/${signal ? signal.date : atLatest ? "" : "replay"}`} />
          </>
        ) : (
          <div className="empty">
            {bars === null
              ? `No price data for ${route.symbol}.`
              : scan === null
                ? `No scan for ${MARKET_LABEL[route.market]} yet. Run: npm run fetch -- --market ${route.market}, then npm run scan -- --market ${route.market}`
                : "Loading…"}
          </div>
        )}
      </main>

      <aside className="evidence">
        {!showSummary && bars && asOf >= 0 && (
          <>
            {signal && bars.d[asOf] === signal.setupDate && <Outcome s={signal} />}
            <Evidence bars={bars} analysis={analysis} asOf={asOf} />
          </>
        )}
        {showSummary && bt && (
          <div className="ev">
            <div className="kicker">How to read this</div>
            <p className="why">
              Pick a signal on the left to see the chart exactly as the detector saw it the day before the breakout, with the entry, stop and exit drawn on what
              followed.
            </p>
            <p className="why">Filters apply to every figure on this page. Grade, contraction count and market trend were all known before the breakout. Breakout volume was not.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
