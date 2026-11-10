import { useEffect, useRef } from "react";
import { Chart, type ChartInput, type ChartOptions } from "../chart/Chart";

/** Mounts the canvas chart and keeps it in step with props. `fitKey` changing re-frames the view. */
export function ChartPane({ input, options, fitKey }: { input: ChartInput | null; options: ChartOptions; fitKey: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const lastFit = useRef("");

  useEffect(() => {
    const c = new Chart(host.current!);
    chart.current = c;
    return () => {
      c.destroy();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.options(options);
  }, [options]);

  useEffect(() => {
    if (!input || !chart.current) return;
    const fit = lastFit.current !== fitKey;
    lastFit.current = fitKey;
    chart.current.set(input, fit);
  }, [input, fitKey]);

  return <div className="chart-host" ref={host} />;
}
