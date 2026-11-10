/**
 * Price chart with the detector's reading drawn on it.
 *
 * Three stacked panes share one time axis: price (log scale by default), the
 * relative-strength line, and volume. Each pane has its own single y-scale.
 * Bars after the as-of date are drawn ghosted so the reading and what followed
 * are never confused.
 */
import type { Bars } from "../../engine/types";
import type { Ind } from "../../engine/indicators";
import type { Analysis } from "../../engine/vcp";
import { zigzag } from "../../engine/swings";
import { FONT, LIGHT, fmtDate, fmtPct, fmtPrice, fmtVol, monthName, type Theme } from "./theme";

export interface TradeMark {
  entryIdx: number;
  entry: number;
  stop: number;
  exitIdx?: number;
  exit?: number;
  label?: string;
}

export interface ChartInput {
  bars: Bars;
  ind: Ind;
  analysis: Analysis | null;
  /** Index of the bar the reading is made on. */
  asOf: number;
  /** Draw bars after asOf (ghosted). Off = the chart ends at asOf. */
  showFuture: boolean;
  trade?: TradeMark;
  benchName?: string;
}

export interface ChartOptions {
  log: boolean;
  candles: boolean;
  swings: boolean;
  theme: Theme;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Seg = [text: string, color: string, weight?: number];

const AXIS_W = 66;
const TIME_H = 24;
const LEGEND_H = 44;

export class Chart {
  private base = document.createElement("canvas");
  private over = document.createElement("canvas");
  private g: CanvasRenderingContext2D;
  private og: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private input: ChartInput | null = null;
  private opt: ChartOptions = { log: true, candles: false, swings: false, theme: LIGHT };
  /** Bar index whose slot touches the right edge of the plot (fractional). */
  private right = 0;
  /** Pixels per bar. */
  private slot = 6;
  private hover: { x: number; y: number } | null = null;
  private drag: { x: number; right: number } | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  private price: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private rsP: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private volP: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private pOf: (y: number) => number = () => 0;
  private needFit = true;

  constructor(private host: HTMLElement) {
    host.style.position = "relative";
    for (const c of [this.base, this.over]) {
      c.style.position = "absolute";
      c.style.inset = "0";
      c.style.width = "100%";
      c.style.height = "100%";
      host.appendChild(c);
    }
    this.over.style.cursor = "crosshair";
    this.over.style.touchAction = "none";
    this.g = this.base.getContext("2d")!;
    this.og = this.over.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.over.addEventListener("wheel", this.onWheel, { passive: false });
    this.over.addEventListener("pointerdown", this.onDown);
    this.over.addEventListener("pointermove", this.onMove);
    this.over.addEventListener("pointerup", this.onUp);
    this.over.addEventListener("pointerleave", this.onLeave);
    this.over.addEventListener("dblclick", this.onDbl);
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.base.remove();
    this.over.remove();
  }

  /** Replace the data. `fit` re-frames the view on the base; otherwise the view is kept. */
  set(input: ChartInput, fit: boolean) {
    this.input = input;
    if (fit) this.needFit = true;
    this.schedule();
  }

  options(o: Partial<ChartOptions>) {
    this.opt = { ...this.opt, ...o };
    this.schedule();
  }

  fit() {
    this.needFit = true;
    this.schedule();
  }

  // ───────────────────────────── view ─────────────────────────────

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width < 10 || r.height < 10) return;
    this.w = Math.floor(r.width);
    this.h = Math.floor(r.height);
    this.dpr = dpr;
    for (const c of [this.base, this.over]) {
      c.width = Math.round(this.w * dpr);
      c.height = Math.round(this.h * dpr);
    }
    this.schedule();
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      this.draw();
      this.drawOverlay();
    });
  }

  private layout() {
    const inp = this.input;
    const plotW = this.w - AXIS_W;
    const body = this.h - TIME_H;
    const hasRs = !!inp && inp.ind.rsLine.some((x) => x === x);
    const volH = Math.round(Math.min(150, Math.max(64, body * 0.17)));
    const rsH = hasRs ? Math.round(Math.min(96, Math.max(46, body * 0.11))) : 0;
    this.price = { x: 0, y: 0, w: plotW, h: body - volH - rsH };
    this.rsP = { x: 0, y: this.price.h, w: plotW, h: rsH };
    this.volP = { x: 0, y: this.price.h + rsH, w: plotW, h: volH };
  }

  private lastDrawable(): number {
    const inp = this.input!;
    return inp.showFuture ? inp.bars.c.length - 1 : inp.asOf;
  }

  private doFit() {
    const inp = this.input!;
    const a = inp.analysis;
    const last = this.lastDrawable();
    // Frame the base with enough of the advance before it to judge the trend.
    const want = a ? Math.min(460, Math.max(120, Math.round(a.base.bars * 2.1 + 60))) : 220;
    let left = inp.asOf - want;
    if (a) left = Math.min(left, a.base.start - 25);
    left = Math.max(0, left);
    const rightIdx = Math.min(last, inp.asOf + (inp.showFuture ? 45 : 0));
    // Leave room on the right for the pivot and stop labels.
    const margin = Math.max(6, Math.round((rightIdx - left) * 0.06));
    this.slot = Math.min(22, Math.max(1.2, this.price.w / (rightIdx - left + 1 + margin)));
    this.right = rightIdx + margin;
  }

  private x(i: number): number {
    return this.price.x + this.price.w - (this.right - i) * this.slot - this.slot / 2;
  }

  private indexAt(px: number): number {
    return Math.round(this.right - (this.price.x + this.price.w - px - this.slot / 2) / this.slot);
  }

  private clampView() {
    const last = this.lastDrawable();
    const span = this.price.w / this.slot;
    this.right = Math.min(last + span * 0.7, Math.max(Math.min(20, last), this.right));
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.input) return;
    e.preventDefault();
    const rect = this.over.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.right += e.deltaX / this.slot;
    } else {
      const edge = this.price.x + this.price.w;
      const anchor = this.right - (edge - px) / this.slot;
      this.slot = Math.min(40, Math.max(0.5, this.slot * Math.exp(-e.deltaY * 0.0016)));
      this.right = anchor + (edge - px) / this.slot;
    }
    this.clampView();
    this.schedule();
  };
  private onDown = (e: PointerEvent) => {
    this.over.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, right: this.right };
    this.over.style.cursor = "grabbing";
  };
  private onMove = (e: PointerEvent) => {
    const rect = this.over.getBoundingClientRect();
    if (this.drag) {
      this.right = this.drag.right - (e.clientX - this.drag.x) / this.slot;
      this.clampView();
      this.hover = null;
      this.schedule();
      return;
    }
    this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.drawOverlay();
  };
  private onUp = (e: PointerEvent) => {
    this.over.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.over.style.cursor = "crosshair";
  };
  private onLeave = () => {
    this.hover = null;
    this.drawOverlay();
  };
  private onDbl = () => this.fit();

  // ───────────────────────────── drawing ─────────────────────────────

  private font(g: CanvasRenderingContext2D, px: number, weight = 400) {
    g.font = `${weight} ${px}px ${FONT}`;
  }

  private draw() {
    const g = this.g;
    const T = this.opt.theme;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = T.surface;
    g.fillRect(0, 0, this.w, this.h);
    const inp = this.input;
    if (!inp || this.w < 50) return;
    this.layout();
    if (this.needFit) {
      this.doFit();
      this.needFit = false;
    }
    this.clampView();

    const { bars: B, ind: I, analysis: A } = inp;
    const P = this.price;
    const last = this.lastDrawable();
    const i0 = Math.max(0, Math.floor(this.right - P.w / this.slot) - 1);
    const i1 = Math.min(last, Math.ceil(this.right));
    if (i1 < i0) return;
    const slot = this.slot;
    const edge = P.x + P.w;

    // Price range of what is on screen, plus the levels the reading adds.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      if (B.l[i] < lo) lo = B.l[i];
      if (B.h[i] > hi) hi = B.h[i];
    }
    if (A && A.pivotIdx <= i1 && inp.asOf >= i0) {
      hi = Math.max(hi, A.pivot * 1.055);
      lo = Math.min(lo, A.stop * 0.995);
    }
    const f = this.opt.log ? Math.log : (v: number) => v;
    const fi = this.opt.log ? Math.exp : (v: number) => v;
    const top = P.y + LEGEND_H;
    const hh = P.h - LEGEND_H - 10;
    const span = f(hi) - f(lo) || 1;
    const ya = f(lo) - span * 0.04;
    const yb = f(hi) + span * 0.09;
    const Y = (p: number) => top + (1 - (f(p) - ya) / (yb - ya)) * hh;
    this.pOf = (y: number) => fi(ya + (1 - (y - top) / hh) * (yb - ya));
    const X = (i: number) => this.x(i);

    // ── grid ──
    const ticks = priceTicks(fi(ya), fi(yb), this.opt.log, hh, Y);
    g.lineWidth = 1;
    g.strokeStyle = T.grid;
    g.beginPath();
    for (const p of ticks) {
      const y = Math.round(Y(p)) + 0.5;
      g.moveTo(P.x, y);
      g.lineTo(edge, y);
    }
    g.stroke();
    const marks = timeMarks(B.d, i0, i1, slot);
    g.beginPath();
    for (const m of marks) {
      const xx = Math.round(X(m.i) - slot / 2) + 0.5;
      g.moveTo(xx, P.y);
      g.lineTo(xx, this.h - TIME_H);
    }
    g.stroke();

    // ── everything in the price pane is clipped to it ──
    g.save();
    g.beginPath();
    g.rect(P.x, P.y, P.w, P.h);
    g.clip();

    const asOfX = X(inp.asOf) + slot / 2;
    if (inp.showFuture && inp.asOf < last && asOfX < edge) {
      g.fillStyle = T.future;
      g.fillRect(asOfX, P.y, edge - asOfX, P.h);
    }

    // Contraction boxes sit under the bars.
    if (A) {
      for (const c of A.contractions) {
        const x0 = X(c.hi);
        const x1 = c.n === A.contractions.length ? X(c.end) + slot / 2 : X(c.end);
        const y0 = Y(c.high);
        const y1 = Y(c.low);
        g.fillStyle = T.boxFill;
        g.fillRect(x0, y0, Math.max(2, x1 - x0), y1 - y0);
      }
      // Buy zone: pivot to +5%, from the pivot high onward.
      const bx = X(A.pivotIdx);
      g.fillStyle = T.buyZone;
      g.fillRect(bx, Y(A.pivot * 1.05), edge - bx, Y(A.pivot) - Y(A.pivot * 1.05));
    }

    // Moving averages.
    const line = (s: Float64Array, color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = "round";
      g.beginPath();
      let pen = false;
      for (let i = i0; i <= i1; i++) {
        const v = s[i];
        if (v !== v) {
          pen = false;
          continue;
        }
        if (pen) g.lineTo(X(i), Y(v));
        else g.moveTo(X(i), Y(v)), (pen = true);
      }
      g.stroke();
    };
    line(I.sma200, T.ma200, 1.4);
    line(I.sma150, T.ma150, 1.1);
    line(I.sma50, T.ma50, 1.4);

    // Minor swings (optional): every turn larger than the local noise threshold.
    if (this.opt.swings && A) {
      const zz = zigzag(B.h, B.l, Math.max(0, A.base.start - 40), inp.asOf, A.metrics.noise);
      g.strokeStyle = T.muted;
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath();
      zz.forEach((s, k) => (k ? g.lineTo(X(s.i), Y(s.price)) : g.moveTo(X(s.i), Y(s.price))));
      g.stroke();
      g.setLineDash([]);
    }

    // Price bars. Colour is the day's direction against the prior close.
    const stem = slot >= 9 ? 2 : slot >= 3.5 ? 1.5 : 1;
    const tick = Math.min(6, Math.max(1.5, slot * 0.36));
    for (let pass = 0; pass < 2; pass++) {
      const upPass = pass === 0;
      g.strokeStyle = upPass ? T.up : T.down;
      g.fillStyle = upPass ? T.up : T.down;
      for (const ghost of [false, true]) {
        g.globalAlpha = ghost ? 0.4 : 1;
        g.lineWidth = stem;
        g.beginPath();
        for (let i = i0; i <= i1; i++) {
          if (i > inp.asOf !== ghost) continue;
          const up = i === 0 ? B.c[i] >= B.o[i] : B.c[i] >= B.c[i - 1];
          if (up !== upPass) continue;
          const xx = snap(X(i), stem);
          if (this.opt.candles && slot >= 3) {
            const bw = Math.max(1, Math.floor(slot * 0.68));
            const yo = Y(B.o[i]);
            const yc = Y(B.c[i]);
            g.moveTo(xx, Y(B.h[i]));
            g.lineTo(xx, Y(B.l[i]));
            g.rect(Math.round(xx - bw / 2), Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
          } else {
            g.moveTo(xx, Y(B.h[i]));
            g.lineTo(xx, Y(B.l[i]));
            if (slot >= 2.5) {
              const yc = Math.round(Y(B.c[i])) + 0.5;
              g.moveTo(xx, yc);
              g.lineTo(xx + tick, yc);
              if (slot >= 5.5) {
                const yo = Math.round(Y(B.o[i])) + 0.5;
                g.moveTo(xx - tick, yo);
                g.lineTo(xx, yo);
              }
            }
          }
        }
        g.stroke();
        if (this.opt.candles && slot >= 3) g.fill();
      }
    }
    g.globalAlpha = 1;

    // ── the reading, over the bars ──
    const tags: { y: number; text: string; bg: string; fg: string }[] = [];
    if (A) {
      const placed: Rect[] = [];
      const K = A.contractions.length;
      for (const c of A.contractions) {
        const x0 = X(c.hi);
        const x1 = c.n === K ? X(c.end) + slot / 2 : X(c.end);
        const y0 = Math.round(Y(c.high)) + 0.5;
        const y1 = Math.round(Y(c.low)) + 0.5;
        g.strokeStyle = T.boxEdge;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(Math.max(x0 + 2, x1), y0);
        g.moveTo(x0, y1);
        g.lineTo(Math.max(x0 + 2, x1), y1);
        g.stroke();
        // The swing itself: high to low.
        g.strokeStyle = T.ink2;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(X(c.hi), Y(c.high));
        g.lineTo(X(c.lo), Y(c.low));
        g.stroke();
        for (const [px, py] of [
          [X(c.hi), Y(c.high)],
          [X(c.lo), Y(c.low)],
        ] as const) {
          g.fillStyle = T.surface;
          g.beginPath();
          g.arc(px, py, 3.2, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = T.ink;
          g.beginPath();
          g.arc(px, py, 2, 0, Math.PI * 2);
          g.fill();
        }
        if (c.shakeout) {
          const sx = X(c.shakeout.lowIdx);
          const sy = Y(c.shakeout.low);
          g.strokeStyle = T.ink2;
          g.beginPath();
          g.arc(sx, sy, 3, 0, Math.PI * 2);
          g.stroke();
        }
        // Depth label above the box, nudged up if it would sit on another label.
        const depth = "−" + (c.depth * 100).toFixed(c.depth < 0.1 ? 1 : 0) + "%";
        this.font(g, 12, 650);
        const wDepth = g.measureText(depth).width;
        this.font(g, 10, 500);
        const tn = "T" + c.n;
        const wT = g.measureText(tn).width;
        const r: Rect = { x: x0 - 1, y: y0 - 19, w: wT + 5 + wDepth + 4, h: 15 };
        for (let guard = 0; guard < 6 && placed.some((q) => overlap(q, r)); guard++) r.y -= 16;
        if (r.y < top - 2) r.y = top - 2;
        placed.push(r);
        g.textBaseline = "middle";
        g.textAlign = "left";
        g.fillStyle = T.muted;
        g.fillText(tn, r.x, r.y + 8);
        this.font(g, 12, 650);
        g.fillStyle = T.ink;
        g.fillText(depth, r.x + wT + 5, r.y + 8);
      }

      // Pivot and stop levels, from where they were set to the right edge.
      const py = Math.round(Y(A.pivot)) + 0.5;
      g.setLineDash([5, 4]);
      g.lineWidth = 1;
      g.strokeStyle = T.ink;
      g.beginPath();
      g.moveTo(X(A.pivotIdx), py);
      g.lineTo(edge, py);
      g.stroke();
      const sy = Math.round(Y(A.stop)) + 0.5;
      const lastC = A.contractions[K - 1];
      g.strokeStyle = T.stop;
      g.beginPath();
      g.moveTo(X(lastC.lo), sy);
      g.lineTo(edge, sy);
      g.stroke();
      g.setLineDash([]);
      this.font(g, 10, 500);
      g.textAlign = "right";
      g.textBaseline = "bottom";
      g.fillStyle = T.good;
      g.fillText("buy zone to +5%", edge - 6, Y(A.pivot * 1.05) + 12);
      tags.push({ y: py, text: "Pivot " + fmtPrice(A.pivot), bg: T.ink, fg: T.surface });
      tags.push({ y: sy, text: "Stop " + fmtPrice(A.stop), bg: T.stop, fg: T.tagText });

      // Advance into the base.
      if (A.base.priorLowIdx >= i0 && A.base.priorLowIdx >= 0) {
        const ax = X(A.base.priorLowIdx);
        const ay = Y(A.base.priorLow);
        this.font(g, 10, 500);
        g.textAlign = "left";
        g.textBaseline = "top";
        g.fillStyle = T.muted;
        g.fillText("advance " + fmtPct(A.base.priorAdvance, 0), ax + 4, ay + 5);
        g.strokeStyle = T.muted;
        g.beginPath();
        g.moveTo(ax - 4, ay + 3.5);
        g.lineTo(ax + 4, ay + 3.5);
        g.stroke();
      }

      if (A.breakout && A.breakout.idx <= i1) {
        const bxx = X(A.breakout.idx);
        const byy = Y(B.l[A.breakout.idx]) + 8;
        g.fillStyle = T.ink;
        tri(g, bxx, byy, 5, true);
        this.font(g, 10, 600);
        g.textAlign = "center";
        g.textBaseline = "top";
        g.fillText("breakout", bxx, byy + 8);
        this.font(g, 10, 400);
        g.fillStyle = T.ink2;
        g.fillText(`vol ${A.breakout.volRatio.toFixed(1)}× avg`, bxx, byy + 20);
      }
    }

    const tr = inp.trade;
    if (tr) {
      const ex = X(tr.entryIdx);
      const end = tr.exitIdx ?? last;
      g.setLineDash([5, 4]);
      g.strokeStyle = T.stop;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ex, Math.round(Y(tr.stop)) + 0.5);
      g.lineTo(X(end), Math.round(Y(tr.stop)) + 0.5);
      g.stroke();
      g.strokeStyle = T.ink;
      g.beginPath();
      g.moveTo(ex, Math.round(Y(tr.entry)) + 0.5);
      g.lineTo(X(end), Math.round(Y(tr.entry)) + 0.5);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = T.ink;
      tri(g, ex - 9, Y(tr.entry), 5, false, true);
      this.font(g, 10, 600);
      g.textAlign = "right";
      g.textBaseline = "middle";
      g.fillText("buy " + fmtPrice(tr.entry), ex - 17, Y(tr.entry));
      if (tr.exitIdx !== undefined && tr.exit !== undefined && tr.exitIdx <= i1) {
        const qx = X(tr.exitIdx);
        g.fillStyle = T.ink;
        tri(g, qx, Y(tr.exit) - 10, 5, false);
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillText(tr.label ?? "exit " + fmtPrice(tr.exit), qx, Y(tr.exit) - 18);
      }
    }

    if (inp.showFuture && inp.asOf < last && asOfX < edge) {
      g.strokeStyle = T.axis;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(asOfX) + 0.5, P.y + LEGEND_H - 6);
      g.lineTo(Math.round(asOfX) + 0.5, P.y + P.h);
      g.stroke();
      this.font(g, 10, 500);
      g.fillStyle = T.muted;
      g.textAlign = "left";
      g.textBaseline = "bottom";
      g.fillText("after " + fmtDate(B.d[inp.asOf]), asOfX + 6, P.y + P.h - 6);
    }
    g.restore();

    // ── price axis ──
    this.font(g, 11, 400);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = T.muted;
    for (const p of ticks) g.fillText(fmtPrice(p), edge + 8, Y(p));
    const lastIdx = Math.min(i1, inp.asOf);
    const lc = B.c[lastIdx];
    tags.push({ y: Y(lc), text: fmtPrice(lc), bg: T.ink2, fg: T.surface });
    this.drawTags(g, tags, edge);

    this.drawRs(g, i0, i1);
    this.drawVolume(g, i0, i1);

    // ── time axis ──
    g.strokeStyle = T.axis;
    g.lineWidth = 1;
    g.beginPath();
    for (const yy of [this.rsP.y, this.volP.y, this.h - TIME_H]) {
      if (yy <= 0) continue;
      g.moveTo(0, Math.round(yy) + 0.5);
      g.lineTo(this.w, Math.round(yy) + 0.5);
    }
    g.moveTo(Math.round(edge) + 0.5, 0);
    g.lineTo(Math.round(edge) + 0.5, this.h - TIME_H);
    g.stroke();
    g.textBaseline = "middle";
    g.textAlign = "left";
    let lastLabelX = -1e9;
    for (const m of marks) {
      const xx = X(m.i) - slot / 2 + 5;
      if (xx < lastLabelX + 34 || xx > edge - 20) continue;
      this.font(g, 11, m.year ? 600 : 400);
      g.fillStyle = m.year ? T.ink2 : T.muted;
      g.fillText(m.label, xx, this.h - TIME_H / 2);
      lastLabelX = xx;
    }
  }

  /** Right-axis price tags, pushed apart so they never overlap. */
  private drawTags(g: CanvasRenderingContext2D, tags: { y: number; text: string; bg: string; fg: string }[], edge: number) {
    tags.sort((a, b) => a.y - b.y);
    for (let k = 1; k < tags.length; k++) if (tags[k].y - tags[k - 1].y < 17) tags[k].y = tags[k - 1].y + 17;
    this.font(g, 11, 600);
    g.textAlign = "left";
    g.textBaseline = "middle";
    for (const t of tags) {
      const wT = g.measureText(t.text).width;
      // Long labels grow leftward into the plot rather than off the canvas.
      const x0 = Math.min(edge + 1, this.w - wT - 12);
      g.fillStyle = t.bg;
      roundRect(g, x0, t.y - 8, wT + 11, 16, 3);
      g.fill();
      g.fillStyle = t.fg;
      g.fillText(t.text, x0 + 6, t.y + 0.5);
    }
  }

  private drawRs(g: CanvasRenderingContext2D, i0: number, i1: number) {
    const R = this.rsP;
    if (R.h <= 0) return;
    const T = this.opt.theme;
    const inp = this.input!;
    const s = inp.ind.rsLine;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const v = s[i];
      if (v !== v) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!(hi > lo)) return;
    const a = Math.log(lo);
    const b = Math.log(hi);
    const Y = (v: number) => R.y + 16 + (1 - (Math.log(v) - a) / (b - a)) * (R.h - 24);
    g.save();
    g.beginPath();
    g.rect(R.x, R.y, R.w, R.h);
    g.clip();
    for (const ghost of [false, true]) {
      g.globalAlpha = ghost ? 0.4 : 1;
      g.strokeStyle = T.rs;
      g.lineWidth = 1.4;
      g.lineJoin = "round";
      g.beginPath();
      let pen = false;
      const from = ghost ? Math.max(i0, inp.asOf) : i0;
      const to = ghost ? i1 : Math.min(i1, inp.asOf);
      for (let i = from; i <= to; i++) {
        const v = s[i];
        if (v !== v) {
          pen = false;
          continue;
        }
        if (pen) g.lineTo(this.x(i), Y(v));
        else g.moveTo(this.x(i), Y(v)), (pen = true);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
    this.font(g, 10, 500);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = T.muted;
    g.fillText(`Relative strength vs ${inp.benchName ?? "benchmark"}`, 10, R.y + 10);
  }

  private drawVolume(g: CanvasRenderingContext2D, i0: number, i1: number) {
    const V = this.volP;
    const T = this.opt.theme;
    const inp = this.input!;
    const { bars: B, ind: I, analysis: A } = inp;
    const slot = this.slot;
    // Scale to the visible range, but do not let one climactic day flatten everything else.
    let vmax = 0;
    let amax = 0;
    for (let i = i0; i <= i1; i++) {
      if (B.v[i] > vmax) vmax = B.v[i];
      if (I.vol50[i] > amax) amax = I.vol50[i];
    }
    const cap = amax > 0 ? Math.min(vmax, amax * 4.5) : vmax;
    if (!(cap > 0)) return;
    const base = V.y + V.h;
    const hh = V.h - 20;
    const Y = (v: number) => base - Math.min(1, v / cap) * hh;
    g.save();
    g.beginPath();
    g.rect(V.x, V.y, V.w, V.h);
    g.clip();
    const bw = Math.max(1, Math.floor(slot * 0.7));
    for (let i = i0; i <= i1; i++) {
      const up = i === 0 ? true : B.c[i] >= B.c[i - 1];
      const heavy = B.v[i] >= I.vol50[i] * 1.4;
      g.globalAlpha = (i > inp.asOf ? 0.4 : 1) * (heavy ? 1 : 0.5);
      g.fillStyle = up ? T.up : T.down;
      const y = Y(B.v[i]);
      g.fillRect(Math.round(this.x(i) - bw / 2), y, bw, base - y);
    }
    g.globalAlpha = 1;
    // 50-day average.
    g.strokeStyle = T.ink2;
    g.lineWidth = 1.2;
    g.beginPath();
    let pen = false;
    for (let i = i0; i <= Math.min(i1, inp.asOf); i++) {
      const v = I.vol50[i];
      if (v !== v) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(this.x(i), Y(v));
      else g.moveTo(this.x(i), Y(v)), (pen = true);
    }
    g.stroke();
    // Volume through the pivot area.
    if (A && Number.isFinite(A.metrics.dryUp)) {
      const lastC = A.contractions[A.contractions.length - 1];
      const xa = this.x(lastC.hi + 1) - slot / 2;
      const xb = this.x(lastC.end) + slot / 2;
      if (xb > xa) {
        g.fillStyle = T.boxEdge;
        g.fillRect(xa, base - 2, xb - xa, 2);
        this.font(g, 10, 600);
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillStyle = T.ink;
        const label = `${A.metrics.dryUp.toFixed(2)}× avg`;
        const lw = g.measureText(label).width;
        g.fillText(label, Math.min(xa, V.x + V.w - lw - 4), V.y + 10);
      }
    }
    g.restore();
    this.font(g, 10, 500);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = T.muted;
    g.fillText("Volume · 50-day average", 10, V.y + 10);
    g.fillText(fmtVol(cap), V.x + V.w + 8, V.y + 20);
  }

  // ───────────────────────────── hover layer ─────────────────────────────

  private drawOverlay() {
    const g = this.og;
    const T = this.opt.theme;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const inp = this.input;
    if (!inp || this.w < 50) return;
    const { bars: B, ind: I } = inp;
    const P = this.price;
    const edge = P.x + P.w;
    const last = this.lastDrawable();
    let i = inp.asOf;
    const hv = this.hover;
    if (hv && hv.x < edge) {
      i = Math.min(last, Math.max(0, this.indexAt(hv.x)));
      const xx = Math.round(this.x(i)) + 0.5;
      g.strokeStyle = T.axis;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xx, P.y + LEGEND_H - 8);
      g.lineTo(xx, this.h - TIME_H);
      g.stroke();
      // Date tag on the time axis.
      this.font(g, 11, 600);
      const dt = fmtDate(B.d[i]);
      const dw = g.measureText(dt).width + 12;
      const dx = Math.min(Math.max(2, xx - dw / 2), edge - dw);
      g.fillStyle = T.ink2;
      roundRect(g, dx, this.h - TIME_H + 4, dw, 16, 3);
      g.fill();
      g.fillStyle = T.surface;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(dt, dx + 6, this.h - TIME_H + 12.5);
      // Price under the pointer.
      if (hv.y > P.y + LEGEND_H - 8 && hv.y < P.y + P.h) {
        const yy = Math.round(hv.y) + 0.5;
        g.strokeStyle = T.axis;
        g.beginPath();
        g.moveTo(P.x, yy);
        g.lineTo(edge, yy);
        g.stroke();
        const txt = fmtPrice(this.pOf(hv.y));
        const tw = g.measureText(txt).width + 11;
        g.fillStyle = T.ink2;
        roundRect(g, edge + 1, yy - 8, tw, 16, 3);
        g.fill();
        g.fillStyle = T.surface;
        g.fillText(txt, edge + 7, yy + 0.5);
      }
    }

    // Readout: the hovered bar, or the as-of bar when the pointer is elsewhere.
    const chg = i > 0 ? B.c[i] / B.c[i - 1] - 1 : 0;
    const vr = B.v[i] / I.vol50[i];
    const row1: Seg[] = [
      [fmtDate(B.d[i]), T.ink, 600],
      ["O", T.muted],
      [fmtPrice(B.o[i]), T.ink2],
      ["H", T.muted],
      [fmtPrice(B.h[i]), T.ink2],
      ["L", T.muted],
      [fmtPrice(B.l[i]), T.ink2],
      ["C", T.muted],
      [fmtPrice(B.c[i]), T.ink, 600],
      [fmtPct(chg, 2), chg >= 0 ? T.good : T.stop, 600],
      ["Vol", T.muted],
      [fmtVol(B.v[i]) + (vr === vr ? `  ${vr.toFixed(2)}× avg` : ""), T.ink2],
    ];
    g.fillStyle = T.surface;
    g.globalAlpha = 0.86;
    g.fillRect(0, 0, edge - 1, LEGEND_H - 8);
    g.globalAlpha = 1;
    this.segs(g, 10, 13, row1);
    // Moving averages, keyed by a stroke of their colour.
    let x = 10;
    const keys: [string, string, number][] = [
      ["50-day", T.ma50, I.sma50[i]],
      ["150-day", T.ma150, I.sma150[i]],
      ["200-day", T.ma200, I.sma200[i]],
    ];
    for (const [name, color, v] of keys) {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 29.5);
      g.lineTo(x + 12, 29.5);
      g.stroke();
      x = this.segs(g, x + 17, 29, [
        [name, T.muted],
        [v === v ? fmtPrice(v) : "–", T.ink2],
      ]);
      x += 10;
    }
    const rs = I.rs[i];
    if (rs === rs) this.segs(g, x, 29, [["RS rating", T.muted], [String(Math.round(rs)), T.ink, 600]]);
  }

  private segs(g: CanvasRenderingContext2D, x: number, y: number, parts: Seg[]): number {
    g.textAlign = "left";
    g.textBaseline = "middle";
    for (const [text, color, weight] of parts) {
      this.font(g, 11, weight ?? 400);
      g.fillStyle = color;
      g.fillText(text, x, y);
      x += g.measureText(text).width + (weight === undefined && text.length <= 3 ? 4 : 9);
    }
    return x;
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function snap(x: number, lineWidth: number): number {
  return lineWidth % 2 === 1 ? Math.round(x) + 0.5 : Math.round(x * 2) / 2;
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Small filled triangle: pointing up, down, or (right = true) to the right. */
function tri(g: CanvasRenderingContext2D, x: number, y: number, s: number, up: boolean, right = false) {
  g.beginPath();
  if (right) {
    g.moveTo(x + s, y);
    g.lineTo(x - s, y - s);
    g.lineTo(x - s, y + s);
  } else if (up) {
    g.moveTo(x, y - s);
    g.lineTo(x - s, y + s);
    g.lineTo(x + s, y + s);
  } else {
    g.moveTo(x, y + s);
    g.lineTo(x - s, y - s);
    g.lineTo(x + s, y - s);
  }
  g.closePath();
  g.fill();
}

/** Round price levels at least ~44px apart on screen. */
function priceTicks(lo: number, hi: number, log: boolean, px: number, Y: (p: number) => number): number[] {
  const out: number[] = [];
  if (!(hi > lo) || !(lo > 0)) return out;
  if (!log || hi / lo < 2.2) {
    const raw = (hi - lo) / Math.max(2, px / 46);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) out.push(Math.round(p / step) * step);
    return out;
  }
  let lastY = Infinity;
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8]) {
      const p = m * 10 ** e;
      if (p < lo || p > hi) continue;
      const y = Y(p);
      if (lastY - y >= 40) {
        out.push(p);
        lastY = y;
      }
    }
  }
  return out;
}

/** Month, quarter or year boundaries, whichever the zoom level can label. */
function timeMarks(d: number[], i0: number, i1: number, slot: number): { i: number; label: string; year: boolean }[] {
  const out: { i: number; label: string; year: boolean }[] = [];
  const perMonth = slot * 21;
  for (let i = Math.max(1, i0); i <= i1; i++) {
    const m = Math.floor(d[i] / 100);
    if (m === Math.floor(d[i - 1] / 100)) continue;
    const month = m % 100;
    const isYear = Math.floor(m / 100) !== Math.floor(d[i - 1] / 10000);
    if (perMonth >= 46 || (perMonth >= 15 && (month - 1) % 3 === 0) || isYear) {
      out.push({ i, label: isYear ? String(Math.floor(m / 100)) : monthName(d[i]), year: isYear });
    }
  }
  return out;
}
