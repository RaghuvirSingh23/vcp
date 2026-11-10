import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bars, Market, UniverseEntry } from "../engine/types";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(ROOT, "data");

export const MARKETS: Record<Market, { label: string; benchmark: string[]; currency: string }> = {
  us: { label: "United States", benchmark: ["^GSPC"], currency: "USD" },
  in: { label: "India (NSE)", benchmark: ["^CRSLDX", "^NSEI"], currency: "INR" },
};

export const barsDir = (m: Market) => join(DATA, "bars", m);
/** File-system-safe name for a symbol (NSE has symbols like M&M, BAJAJ-AUTO). */
export const fileKey = (symbol: string) => symbol.replace(/[^A-Za-z0-9._-]/g, "_");
export const barsPath = (m: Market, symbol: string) => join(barsDir(m), fileKey(symbol) + ".json");
export const benchPath = (m: Market) => join(barsDir(m), "_benchmark.json");
export const universePath = (m: Market) => join(DATA, "universe", m + ".json");

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export const loadBars = (m: Market, symbol: string) => readJson<Bars>(barsPath(m, symbol));
export const loadUniverse = (m: Market) => readJson<UniverseEntry[]>(universePath(m)) ?? [];

/** Every symbol that has a bars file on disk, benchmark excluded. */
export function loadAllBars(m: Market): Bars[] {
  const dir = barsDir(m);
  if (!existsSync(dir)) return [];
  const out: Bars[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const b = readJson<Bars>(join(dir, f));
    if (b && b.d.length) out.push(b);
  }
  return out;
}

/** --key value and --flag arguments. */
export function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    if (i + 1 < a.length && !a[i + 1].startsWith("--")) out[k] = a[++i];
    else out[k] = "true";
  }
  return out;
}

export function markets(a: Record<string, string>): Market[] {
  const m = a.market ?? "all";
  if (m === "all") return ["us", "in"];
  if (m !== "us" && m !== "in") throw new Error(`--market must be us, in or all (got ${m})`);
  return [m];
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
