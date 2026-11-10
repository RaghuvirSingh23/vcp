/** Chart colours by role. Both modes are chosen, not derived from each other. */
export interface Theme {
  dark: boolean;
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  /** Close above / below the prior close. */
  up: string;
  down: string;
  ma50: string;
  ma150: string;
  ma200: string;
  rs: string;
  /** Contraction boxes. */
  boxFill: string;
  boxEdge: string;
  buyZone: string;
  good: string;
  stop: string;
  /** Tint over bars that come after the as-of date. */
  future: string;
  tagText: string;
}

export const LIGHT: Theme = {
  dark: false,
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#898781",
  grid: "#ecebe6",
  axis: "#c3c2b7",
  up: "#2a78d6",
  down: "#e34948",
  ma50: "#eb6834",
  ma150: "#1baf7a",
  ma200: "#6250d6",
  rs: "#52514e",
  boxFill: "rgba(237,161,0,0.13)",
  boxEdge: "#c98500",
  buyZone: "rgba(12,163,12,0.10)",
  good: "#006300",
  stop: "#d03b3b",
  future: "rgba(137,135,129,0.07)",
  tagText: "#ffffff",
};

export const DARK: Theme = {
  dark: true,
  surface: "#1a1a19",
  ink: "#f0efec",
  ink2: "#c3c2b7",
  muted: "#898781",
  grid: "#262624",
  axis: "#383835",
  up: "#3987e5",
  down: "#e66767",
  ma50: "#d95926",
  ma150: "#199e70",
  ma200: "#9085e9",
  rs: "#c3c2b7",
  boxFill: "rgba(250,178,25,0.12)",
  boxEdge: "#c98500",
  buyZone: "rgba(12,163,12,0.14)",
  good: "#0ca30c",
  stop: "#e66767",
  future: "rgba(240,239,236,0.04)",
  tagText: "#0b0b0b",
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 20040108 -> "8 Jan 2004" */
export function fmtDate(d: number): string {
  return `${d % 100} ${MONTHS[(Math.floor(d / 100) % 100) - 1]} ${Math.floor(d / 10000)}`;
}
export const monthName = (d: number) => MONTHS[(Math.floor(d / 100) % 100) - 1];

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "–";
  const a = Math.abs(p);
  if (a >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (a >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

export function fmtVol(v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return String(Math.round(v));
}

export const fmtPct = (x: number, d = 1) => (Number.isFinite(x) ? (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(d) + "%" : "–");
