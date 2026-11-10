/**
 * The interactive chart: two stacked canvases (drawing, hover layer) around ChartCore,
 * plus pointer and wheel handling.
 */
import { ChartCore, type ChartInput, type ChartOptions } from "./core";

export type { ChartInput, ChartOptions, TradeMark } from "./core";

export class Chart {
  private base = document.createElement("canvas");
  private over = document.createElement("canvas");
  private g: CanvasRenderingContext2D;
  private og: CanvasRenderingContext2D;
  private core = new ChartCore();
  private drag: { x: number; right: number } | null = null;
  private raf = 0;
  private ro: ResizeObserver;

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

  set(input: ChartInput, fit: boolean) {
    this.core.set(input, fit);
    this.schedule();
  }

  options(o: Partial<ChartOptions>) {
    this.core.opt = { ...this.core.opt, ...o };
    this.schedule();
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width < 10 || r.height < 10) return;
    this.core.size(Math.floor(r.width), Math.floor(r.height), dpr);
    for (const c of [this.base, this.over]) {
      c.width = Math.round(this.core.w * dpr);
      c.height = Math.round(this.core.h * dpr);
    }
    this.schedule();
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      this.core.draw(this.g);
      this.core.drawOverlay(this.og);
    });
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.core.input) return;
    e.preventDefault();
    const rect = this.over.getBoundingClientRect();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.core.pan(e.deltaX);
    else this.core.zoom(e.clientX - rect.left, Math.exp(-e.deltaY * 0.0016));
    this.schedule();
  };
  private onDown = (e: PointerEvent) => {
    this.over.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, right: this.core.right };
    this.over.style.cursor = "grabbing";
  };
  private onMove = (e: PointerEvent) => {
    const rect = this.over.getBoundingClientRect();
    if (this.drag) {
      this.core.right = this.drag.right - (e.clientX - this.drag.x) / this.core.slot;
      this.core.clampView();
      this.core.hover = null;
      this.schedule();
      return;
    }
    this.core.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.core.drawOverlay(this.og);
  };
  private onUp = (e: PointerEvent) => {
    this.over.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.over.style.cursor = "crosshair";
  };
  private onLeave = () => {
    this.core.hover = null;
    this.core.drawOverlay(this.og);
  };
  private onDbl = () => {
    this.core.fit();
    this.schedule();
  };
}
