import { useEffect, useMemo, useRef, useState } from "react";
import type { Market } from "../../engine/types";
import { fmtPct, fmtPrice } from "../chart/theme";
import type { ScanFile, ScanRow } from "../data";

type Tab = "pivot" | "breakout" | "forming" | "near" | "all";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "pivot", label: "At pivot", hint: "Valid setups in the upper half of the final contraction" },
  { id: "breakout", label: "Breakouts", hint: "Valid setups that have traded through the pivot and are still in the buy zone" },
  { id: "forming", label: "Forming", hint: "Valid setups still in the lower half of the final contraction" },
  { id: "near", label: "Near miss", hint: "One required check short of valid" },
  { id: "all", label: "All", hint: "Every stock in the universe" },
];

/** What a failed check means, in three words or fewer. */
export const FAIL_LABEL: Record<string, string> = {
  tt1: "below 150/200-day",
  tt2: "150-day under 200-day",
  tt3: "200-day not rising",
  tt4: "50-day not on top",
  tt5: "below 50-day",
  tt6: "too near 52w low",
  tt7: "too far off high",
  tt8: "RS under 70",
  b_len: "base length",
  b_depth: "base too deep",
  b_adv: "no prior advance",
  c_count: "one contraction",
  c_step: "not shrinking",
  c_ratio: "not halved",
  c_tight: "pivot too wide",
  c_pos: "pivot low in base",
  c_bars: "pivot too new",
  v_dry: "volume not dry",
  v_range: "bars not tight",
  v_pin: "pinned price",
  none: "no base",
};

function inTab(r: ScanRow, tab: Tab): boolean {
  switch (tab) {
    case "pivot":
      return r.valid && r.state === "ready";
    case "breakout":
      return r.valid && r.state === "breakout";
    case "forming":
      return r.valid && r.state === "forming";
    case "near":
      return !r.valid && r.failed.length === 1 && r.failed[0] !== "none";
    case "all":
      return true;
  }
}

export function ScanList({
  scan,
  market,
  selected,
  onSelect,
}: {
  scan: ScanFile | null | undefined;
  market: Market;
  selected: string | null;
  onSelect: (symbol: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("pivot");
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { pivot: 0, breakout: 0, forming: 0, near: 0, all: 0 };
    for (const r of scan?.rows ?? []) for (const t of TABS) if (inTab(r, t.id)) c[t.id]++;
    return c;
  }, [scan]);

  // Land on the first tab that has anything in it.
  useEffect(() => {
    if (!scan) return;
    const first = TABS.find((t) => counts[t.id] > 0);
    if (first && counts[tab] === 0) setTab(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, market]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = (scan?.rows ?? []).filter((r) =>
      needle ? r.symbol.toLowerCase().startsWith(needle) || r.name.toLowerCase().includes(needle) : inTab(r, tab),
    );
    if (needle) out = out.sort((a, b) => Number(b.symbol.toLowerCase() === needle) - Number(a.symbol.toLowerCase() === needle));
    else if (tab === "all") out = [...out].sort((a, b) => a.symbol.localeCompare(b.symbol));
    else if (tab === "breakout") out = [...out].sort((a, b) => (a.breakout?.barsAgo ?? 99) - (b.breakout?.barsAgo ?? 99) || b.score - a.score);
    return out.slice(0, 400);
  }, [scan, tab, q]);

  // Up/down moves through the list.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "j" && e.key !== "k") return;
      if ((e.key === "j" || e.key === "k") && t.tagName === "INPUT") return;
      const i = rows.findIndex((r) => r.symbol === selected);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)))];
      if (next) {
        onSelect(next.symbol);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [rows, selected, onSelect]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <>
      <div className="search">
        <input placeholder="Symbol or name" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={!q && tab === t.id} title={t.hint} onClick={() => (setQ(""), setTab(t.id))}>
            {t.label}
            <span className="count">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <div className="rows" ref={listRef} role="listbox">
        {scan === undefined && <div className="note">Loading…</div>}
        {scan && rows.length === 0 && <div className="note">{q ? "No match." : "Nothing here on this date."}</div>}
        {rows.map((r) => (
          <button key={r.symbol} className="row" role="option" aria-selected={r.symbol === selected} onClick={() => onSelect(r.symbol)}>
            <div className="l1">
              <span className="sym">{r.symbol}</span>
              <span className="nm">{r.name}</span>
              <span className="px">{fmtPrice(r.close)}</span>
              <span className={"chg " + (r.chg >= 0 ? "up" : "down")}>{fmtPct(r.chg, 1)}</span>
            </div>
            <div className="l2">
              {r.footprint ? <span className="fp">{r.footprint}</span> : <span className="fp dim">–</span>}
              {r.valid ? (
                <span className="where">
                  {r.state === "breakout"
                    ? `through ${fmtPrice(r.pivot)}, ${r.breakout?.barsAgo ?? 0}d ago`
                    : r.state === "extended"
                      ? `extended past ${fmtPrice(r.pivot)}`
                      : `pivot ${fmtPrice(r.pivot)} · ${(r.dist * 100).toFixed(1)}% away`}
                </span>
              ) : (
                <span className="where dim">
                  {r.failed
                    .slice(0, 2)
                    .map((f) => FAIL_LABEL[f] ?? f)
                    .join(", ")}
                  {r.failed.length > 2 ? ` +${r.failed.length - 2}` : ""}
                </span>
              )}
              {r.valid && <span className="score" title="Setup quality, 0–100">{r.score}</span>}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
