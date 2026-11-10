import { useMemo, useState } from "react";
import { HORIZONS, summarize, type Signal } from "../../engine/backtest";
import { fmtDate, fmtPct, fmtPrice } from "../chart/theme";
import { BENCH_NAME, type BacktestFile } from "../data";

export interface Filters {
  period: "all" | "5y" | "2020s" | "2010s" | "2000s";
  score: number;
  count: "any" | "2" | "3" | "4";
  volume: "any" | "confirmed";
  market: "any" | "uptrend";
}
export const NO_FILTERS: Filters = { period: "all", score: 0, count: "any", volume: "any", market: "any" };

export function applyFilters(file: BacktestFile, f: Filters): Signal[] {
  const lastYear = Math.floor(file.to / 10000);
  return file.signals.filter((s) => {
    if (s.chase) return false;
    const y = Math.floor(s.date / 10000);
    if (f.period === "5y" && y < lastYear - 4) return false;
    if (f.period === "2020s" && y < 2020) return false;
    if (f.period === "2010s" && (y < 2010 || y > 2019)) return false;
    if (f.period === "2000s" && y > 2009) return false;
    if (s.score < f.score) return false;
    if (f.count === "2" && s.count !== 2) return false;
    if (f.count === "3" && s.count !== 3) return false;
    if (f.count === "4" && s.count < 4) return false;
    if (f.volume === "confirmed" && !(s.volRatio >= file.params.breakoutVolMult)) return false;
    if (f.market === "uptrend" && s.uptrend !== true) return false;
    return true;
  });
}

const R = (x: number, d = 2) => (Number.isFinite(x) ? (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d) + "R" : "–");
const P = (x: number, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "–");

/** Filter row + signal list, for the side column. */
export function SignalList({
  file,
  filters,
  onFilters,
  signals,
  selected,
  onSelect,
}: {
  file: BacktestFile | null | undefined;
  filters: Filters;
  onFilters: (f: Filters) => void;
  signals: Signal[];
  selected: Signal | null;
  onSelect: (s: Signal | null) => void;
}) {
  const [sort, setSort] = useState<"date" | "r" | "score">("date");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const out = needle ? signals.filter((s) => s.symbol.startsWith(needle)) : [...signals];
    if (sort === "date") out.sort((a, b) => b.date - a.date);
    else if (sort === "r") out.sort((a, b) => b.r - a.r);
    else out.sort((a, b) => b.score - a.score || b.date - a.date);
    return out;
  }, [signals, sort, q]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onFilters({ ...filters, [k]: v });

  return (
    <>
      <div className="filters">
        <label>
          Period
          <select value={filters.period} onChange={(e) => set("period", e.target.value as Filters["period"])}>
            <option value="all">All years</option>
            <option value="5y">Last 5 years</option>
            <option value="2020s">2020s</option>
            <option value="2010s">2010s</option>
            <option value="2000s">2000s</option>
          </select>
        </label>
        <label>
          Quality
          <select value={filters.score} onChange={(e) => set("score", Number(e.target.value))}>
            <option value={0}>Any score</option>
            <option value={50}>50 and up</option>
            <option value={60}>60 and up</option>
            <option value={70}>70 and up</option>
            <option value={80}>80 and up</option>
          </select>
        </label>
        <label>
          Contractions
          <select value={filters.count} onChange={(e) => set("count", e.target.value as Filters["count"])}>
            <option value="any">Any count</option>
            <option value="2">2T</option>
            <option value="3">3T</option>
            <option value="4">4T or more</option>
          </select>
        </label>
        <label title="Breakout-day volume is only known at that day's close, after a buy-stop at the pivot would have filled.">
          Breakout volume
          <select value={filters.volume} onChange={(e) => set("volume", e.target.value as Filters["volume"])}>
            <option value="any">Any</option>
            <option value="confirmed">1.4× average or more</option>
          </select>
        </label>
        <label title="Benchmark above its own 200-day average on the day before the breakout.">
          Market
          <select value={filters.market} onChange={(e) => set("market", e.target.value as Filters["market"])}>
            <option value="any">Any</option>
            <option value="uptrend">Uptrend only</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="date">Newest first</option>
            <option value="r">Best result first</option>
            <option value="score">Highest quality first</option>
          </select>
        </label>
      </div>
      <div className="search slim">
        <input placeholder="Filter by symbol" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
        <button className="ghost" onClick={() => onSelect(null)} disabled={!selected}>
          Summary
        </button>
      </div>
      <div className="rows" role="listbox">
        {file === undefined && <div className="note">Loading…</div>}
        {file === null && <div className="note">No backtest yet. Run: npm run backtest</div>}
        {file && rows.length === 0 && <div className="note">No signals match.</div>}
        {rows.slice(0, 500).map((s) => (
          <button
            key={s.symbol + s.date}
            className="row"
            role="option"
            aria-selected={selected?.symbol === s.symbol && selected.date === s.date}
            onClick={() => onSelect(s)}
          >
            <div className="l1">
              <span className="sym">{s.symbol}</span>
              <span className="nm">{fmtDate(s.date)}</span>
              <span className={"px " + (s.reason === "open" ? "dim" : s.r > 0 ? "up" : "down")}>{s.reason === "open" ? "open" : R(s.r, 1)}</span>
            </div>
            <div className="l2">
              <span className="fp">{s.footprint}</span>
              <span className="where">
                {s.reason === "stop" ? "stopped" : s.reason === "trend" ? "closed under 50-day" : "still open"} · {s.hold}d
              </span>
              <span className="score" title="Setup quality, 0–100">
                {s.score}
              </span>
            </div>
          </button>
        ))}
        {rows.length > 500 && <div className="note">Showing 500 of {rows.length.toLocaleString()}. Narrow the filters to see the rest.</div>}
      </div>
    </>
  );
}

/** Aggregate results for the filtered signals, for the main column. */
export function BacktestSummary({ file, signals }: { file: BacktestFile; signals: Signal[] }) {
  const S = useMemo(() => summarize(signals), [signals]);
  const years = useMemo(() => {
    const m = new Map<number, Signal[]>();
    for (const s of signals) {
      const y = Math.floor(s.date / 10000);
      if (!m.has(y)) m.set(y, []);
      m.get(y)!.push(s);
    }
    return [...m].sort((a, b) => a[0] - b[0]).map(([y, list]) => ({ y, n: list.length, s: summarize(list) }));
  }, [signals]);
  const maxAbs = Math.max(0.5, ...years.map((r) => Math.abs(r.s.avgR) || 0));

  return (
    <div className="bt">
      <div className="bt-head">
        <h2>Every pivot breakout, {fmtDate(file.from)} to {fmtDate(file.to)}</h2>
        <p>
          {signals.length.toLocaleString()} signals from {file.symbols.toLocaleString()} stocks. The detector read each day using only earlier bars; a buy-stop
          rested at the pivot; the stop was the final contraction's low; the exit was that stop or the first close under the 50-day average.
        </p>
      </div>

      <div className="tiles">
        <Tile label="Closed trades" value={S.n.toLocaleString()} />
        <Tile label="Win rate" value={P(S.winRate)} />
        <Tile label="Average result" value={R(S.avgR)} tone={S.avgR >= 0 ? "up" : "down"} />
        <Tile label="Average win" value={R(S.avgWinR)} />
        <Tile label="Average loss" value={R(S.avgLossR)} />
        <Tile label="Profit factor" value={Number.isFinite(S.profitFactor) ? S.profitFactor.toFixed(2) : "–"} />
        <Tile label="Average hold" value={Number.isFinite(S.avgHold) ? S.avgHold.toFixed(0) + " days" : "–"} />
        <Tile label="Average risk" value={P(S.avgRisk)} />
      </div>

      <div className="bt-grid">
        <section>
          <h3>Cumulative result, one unit of risk per signal</h3>
          <CumulativeR signals={signals} />
          <p className="fine">Sum of R over closed trades in order of entry. Every signal is taken, with no limit on positions or capital: this is the signals' record, not a portfolio.</p>
        </section>
        <section>
          <h3>Distribution of results</h3>
          <Histogram signals={signals} />
          <p className="fine">Closed trades by result in R. Results past +10R are gathered in the last bar.</p>
        </section>
      </div>

      <div className="bt-grid">
        <section>
          <h3>Return after the breakout, no exit rule</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>Sessions held</th>
                <th>Mean</th>
                <th>Median</th>
                <th>Positive</th>
                <th>Mean vs {file.benchmark ? (BENCH_NAME[file.benchmark] ?? file.benchmark) : "benchmark"}</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {S.horizons.map((h, k) => (
                <tr key={h.bars}>
                  <td>{HORIZONS[k]}</td>
                  <td>{fmtPct(h.mean)}</td>
                  <td>{fmtPct(h.median)}</td>
                  <td>{P(h.positive, 0)}</td>
                  <td className={h.excess >= 0 ? "up" : "down"}>{fmtPct(h.excess)}</td>
                  <td>{h.n.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine">Close after N sessions against the entry price, and the same minus the benchmark's return over those sessions.</p>
        </section>
        <section>
          <h3>By year</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th>
                <th>Signals</th>
                <th>Win rate</th>
                <th>Average result</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {years.map((r) => (
                <tr key={r.y}>
                  <td>{r.y}</td>
                  <td>{r.n}</td>
                  <td>{P(r.s.winRate, 0)}</td>
                  <td className={r.s.avgR >= 0 ? "up" : "down"}>{R(r.s.avgR)}</td>
                  <td className="barcell">
                    <span className="zero" />
                    {Number.isFinite(r.s.avgR) && (
                      <span
                        className={"bar " + (r.s.avgR >= 0 ? "pos" : "neg")}
                        style={{ width: (Math.abs(r.s.avgR) / maxAbs) * 50 + "%", [r.s.avgR >= 0 ? "left" : "right"]: "50%" }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="caveats">
        <h3>Read this before trusting the numbers</h3>
        <ul>
          <li>
            The universe is today's listings. Stocks that were delisted, acquired or went to zero are missing, so every figure here is flattered by survivorship. The
            same bias lifts the relative-strength ratings of the stocks that remain.
          </li>
          <li>Fills are assumed at the pivot, or at the open on a gap. No commissions, slippage or position limits are applied.</li>
          <li>Signals whose open gapped more than {P(file.params.buyZone, 0)} past the pivot are left out: buying those is chasing, not the pattern.</li>
          <li>Prices are split-adjusted daily bars from Yahoo Finance. A handful of symbols have vendor errors that no filter fully removes.</li>
        </ul>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="tile">
      <div className="tl">{label}</div>
      <div className={"tv " + (tone ?? "")}>{value}</div>
    </div>
  );
}

/** Outcome box for one signal, shown above the evidence panel. */
export function Outcome({ s }: { s: Signal }) {
  return (
    <div className="outcome">
      <div className="kicker">Breakout on {fmtDate(s.date)}</div>
      <div className={"headline " + (s.reason === "open" ? "" : s.r > 0 ? "up" : "down")}>
        {s.reason === "open" ? "Trade still open" : `${R(s.r)} · ${fmtPct(s.ret)}`}
      </div>
      <dl className="levels">
        <div>
          <dt>Entry</dt>
          <dd>{fmtPrice(s.entry)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd>{fmtPrice(s.stop)}</dd>
        </div>
        <div>
          <dt>Exit</dt>
          <dd>{fmtPrice(s.exit)}</dd>
        </div>
        <div>
          <dt>Held</dt>
          <dd>{s.hold}d</dd>
        </div>
      </dl>
      <p className="why">
        {s.reason === "stop" ? "Stopped out" : s.reason === "trend" ? "Sold after a close under the 50-day average" : "Marked at the last close"} on {fmtDate(s.exitDate)}.
        Breakout volume {s.volRatio.toFixed(1)}× average{s.held ? "" : "; the breakout day closed back under the pivot"}
        {s.gap > 0 ? `; opened ${P(s.gap)} above the pivot` : ""}. Best {fmtPct(s.mfe)} and worst {fmtPct(s.mae)} within 60 sessions.
      </p>
      <table className="tbl mini">
        <thead>
          <tr>
            <th>After</th>
            {HORIZONS.map((h) => (
              <th key={h}>{h}d</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Stock</td>
            {s.fwd.map((v, k) => (
              <td key={k}>{v === null ? "–" : fmtPct(v)}</td>
            ))}
          </tr>
          <tr>
            <td>Benchmark</td>
            {s.bench.map((v, k) => (
              <td key={k}>{v === null ? "–" : fmtPct(v)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── small charts ─────────────────────────

const yearOf = (d: number) => Math.floor(d / 10000);
const dayNumber = (d: number) => Date.UTC(yearOf(d), (Math.floor(d / 100) % 100) - 1, d % 100) / 86400e3;

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

function CumulativeR({ signals }: { signals: Signal[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => {
    const closed = signals.filter((s) => s.reason !== "open").sort((a, b) => a.date - b.date);
    let sum = 0;
    return closed.map((s, i) => ({ x: dayNumber(s.date), y: (sum += s.r), d: s.date, n: i + 1 }));
  }, [signals]);
  const W = 560;
  const H = 230;
  const m = { l: 44, r: 12, t: 10, b: 24 };
  if (pts.length < 2) return <div className="nochart">Not enough closed trades to draw.</div>;
  const x0 = pts[0].x;
  const x1 = pts[pts.length - 1].x;
  const lo = Math.min(0, ...pts.map((p) => p.y));
  const hi = Math.max(0, ...pts.map((p) => p.y));
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (y: number) => m.t + (1 - (y - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const step = niceStep(hi - lo, 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const y0 = yearOf(pts[0].d);
  const y1 = yearOf(pts[pts.length - 1].d);
  const yStep = Math.max(1, Math.ceil((y1 - y0) / 7));
  const yearTicks: number[] = [];
  for (let y = y0 + 1; y <= y1; y += yStep) yearTicks.push(y);
  const path = pts.map((p, i) => (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1)).join("");
  const hp = hover === null ? null : pts[hover];

  return (
    <div className="chartbox">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Cumulative result in R over time"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const tx = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
          let lo2 = 0;
          let hi2 = pts.length - 1;
          while (lo2 < hi2) {
            const mid = (lo2 + hi2) >> 1;
            if (pts[mid].x < tx) lo2 = mid + 1;
            else hi2 = mid;
          }
          setHover(lo2);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? "base" : "grid"} />
            <text x={m.l - 6} y={Y(v)} className="tick" textAnchor="end" dominantBaseline="middle">
              {v.toLocaleString()}R
            </text>
          </g>
        ))}
        {yearTicks.map((y) => (
          <text key={y} x={X(dayNumber(y * 10000 + 101))} y={H - 7} className="tick" textAnchor="middle">
            {y}
          </text>
        ))}
        <path d={path} className="line" />
        {hp && (
          <g>
            <line x1={X(hp.x)} x2={X(hp.x)} y1={m.t} y2={H - m.b} className="cross" />
            <circle cx={X(hp.x)} cy={Y(hp.y)} r={4} className="dot" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${(X(hp.x) / W) * 100}%` }}>
          <b>{R(hp.y, 1)}</b>
          <span>
            {fmtDate(hp.d)} · {hp.n.toLocaleString()} trades
          </span>
        </div>
      )}
    </div>
  );
}

function Histogram({ signals }: { signals: Signal[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const bins = useMemo(() => {
    const lo = -2;
    const hi = 10;
    const w = 0.5;
    const n = Math.round((hi - lo) / w) + 1;
    const out = Array.from({ length: n }, (_, i) => ({ from: lo + i * w, count: 0 }));
    for (const s of signals) {
      if (s.reason === "open") continue;
      const k = Math.min(n - 1, Math.max(0, Math.floor((s.r - lo) / w)));
      out[k].count++;
    }
    return out;
  }, [signals]);
  const W = 560;
  const H = 230;
  const m = { l: 44, r: 12, t: 10, b: 24 };
  const max = Math.max(1, ...bins.map((b) => b.count));
  const bw = (W - m.l - m.r) / bins.length;
  const Y = (c: number) => m.t + (1 - c / max) * (H - m.t - m.b);
  const step = niceStep(max, 4);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const hb = hover === null ? null : bins[hover];
  return (
    <div className="chartbox">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram of trade results in R" onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? "base" : "grid"} />
            <text x={m.l - 6} y={Y(v)} className="tick" textAnchor="end" dominantBaseline="middle">
              {v.toLocaleString()}
            </text>
          </g>
        ))}
        {bins.map((b, i) => (
          <g key={i} onPointerMove={() => setHover(i)}>
            <rect x={m.l + i * bw} y={m.t} width={bw} height={H - m.t - m.b} fill="transparent" />
            {b.count > 0 && (
              <rect
                x={m.l + i * bw + 1}
                y={Y(b.count)}
                width={Math.max(1, bw - 2)}
                height={H - m.b - Y(b.count)}
                className={(b.from >= 0 ? "pos" : "neg") + (hover === i ? " hot" : "")}
                rx={1.5}
              />
            )}
          </g>
        ))}
        {[-2, 0, 2, 4, 6, 8, 10].map((v) => (
          <text key={v} x={m.l + ((v + 2) / 0.5) * bw} y={H - 7} className="tick" textAnchor="middle">
            {v === 10 ? "10R+" : v + "R"}
          </text>
        ))}
      </svg>
      {hb && hover !== null && (
        <div className="tip" style={{ left: `${((m.l + (hover + 0.5) * bw) / W) * 100}%` }}>
          <b>{hb.count.toLocaleString()} trades</b>
          <span>{hover === bins.length - 1 ? "+10R or better" : `${R(hb.from, 1)} to ${R(hb.from + 0.5, 1)}`}</span>
        </div>
      )}
    </div>
  );
}
