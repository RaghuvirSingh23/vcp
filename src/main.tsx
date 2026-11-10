import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.DEV) {
  // Save the chart canvas as data/shots/<name>.png (dev aid for reviewing readings).
  (window as any).__shot = async (name: string) => {
    const cs = document.querySelectorAll<HTMLCanvasElement>(".chart-host canvas");
    if (cs.length < 2) return "no chart";
    const c = document.createElement("canvas");
    c.width = cs[0].width;
    c.height = cs[0].height;
    const g = c.getContext("2d")!;
    g.drawImage(cs[0], 0, 0);
    g.drawImage(cs[1], 0, 0);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    await fetch("/__shot?name=" + encodeURIComponent(name), { method: "POST", body: blob });
    return `${c.width}x${c.height}`;
  };
}
