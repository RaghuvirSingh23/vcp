import type { Bars } from "../../engine/types";
import type { Analysis, Check, CheckGroup } from "../../engine/vcp";
import { fmtDate, fmtPrice } from "../chart/theme";
import { FAIL_LABEL, WEAK_LABEL } from "./ScanList";

const GROUPS: { id: CheckGroup; title: string }[] = [
  { id: "trend", title: "Trend template" },
  { id: "base", title: "Base" },
  { id: "contraction", title: "Contractions" },
  { id: "volume", title: "Volume and tightness" },
];

const STATE_TEXT: Record<string, string> = {
  ready: "at the pivot",
  forming: "still forming",
  breakout: "through the pivot",
  extended: "extended past the pivot",
};

function Mark({ c }: { c: Check }) {
  if (c.pass === null) return <span className="mark na" title="Not applicable">·</span>;
  return c.pass ? (
    <span className="mark ok" title="Pass">
      ✓
    </span>
  ) : (
    <span className={"mark " + (c.required ? "no" : "soft")} title={c.required ? "Fail (required)" : "Miss (quality only)"}>
      ✕
    </span>
  );
}

export function Evidence({ bars, analysis: a, asOf }: { bars: Bars; analysis: Analysis | null; asOf: number }) {
  if (!a) {
    return (
      <div className="ev">
        <div className="verdict">
          <div className="kicker">{fmtDate(bars.d[asOf])}</div>
          <div className="headline no">No base to read</div>
          <p className="why">Price is at a fresh high with no pullback behind it, or there is too little history.</p>
        </div>
      </div>
    );
  }
  const D = (i: number) => fmtDate(bars.d[i]);
  return (
    <div className="ev">
      <div className="verdict">
        <div className="kicker">Read on {fmtDate(a.date)}</div>
        <div className={"headline " + (a.valid ? "ok" : "no")}>{a.valid ? `VCP, ${STATE_TEXT[a.state]}` : "Not a VCP"}</div>
        {a.valid ? (
          <>
            <div className={"gradeline " + (a.grade === "A" ? "a" : "b")}>
              <span className={"grade " + (a.grade === "A" ? "a" : "b")}>{a.grade}</span>
              {a.grade === "A" ? "Textbook: no weakness" : "Valid, with: " + a.weaknesses.map((w) => WEAK_LABEL[w] ?? w).join(", ")}
            </div>
            <p className="why">
              {a.kind === "classic" ? "Pivot in the upper third of the base." : a.kind === "cheat" ? "Pivot in the middle third of the base." : "Pivot in the lower third of the base."}
              {a.young ? " Less than a year of history, so long moving averages are not applicable." : ""}
            </p>
          </>
        ) : (
          <p className="why">Fails: {a.failed.map((f) => FAIL_LABEL[f] ?? f).join(", ") || "a required check could not be evaluated"}.</p>
        )}
      </div>

      <div className="foot">
        <div className="fp-big">{a.footprint}</div>
        <div className="fp-key">
          {a.base.weeks} weeks · deepest {(a.base.depth * 100).toFixed(0)}% · tightest {(a.contractions[a.contractions.length - 1].depth * 100).toFixed(1)}% ·{" "}
          {a.contractions.length} contraction{a.contractions.length > 1 ? "s" : ""}
        </div>
        {a.valid && (
          <div className="scoreline">
            <span>Quality</span>
            <div className="meter">
              <div style={{ width: a.score + "%" }} />
            </div>
            <b>{a.score}</b>
          </div>
        )}
      </div>

      <dl className="levels">
        <div>
          <dt>Pivot</dt>
          <dd>{fmtPrice(a.pivot)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd>{fmtPrice(a.stop)}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{(a.riskPct * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>{a.distPct >= 0 ? "To pivot" : "Past pivot"}</dt>
          <dd>{Math.abs(a.distPct * 100).toFixed(1)}%</dd>
        </div>
      </dl>
      {a.breakout && (
        <p className="bo">
          Traded through the pivot on {fmtDate(a.breakout.date)} on {a.breakout.volRatio.toFixed(1)}× average volume
          {a.breakout.closedAbove ? "" : ", closed back under it"}.
        </p>
      )}

      <h3>Contractions</h3>
      <table className="cons">
        <thead>
          <tr>
            <th></th>
            <th>High</th>
            <th>Low</th>
            <th>Depth</th>
            <th>Days</th>
            <th>Vol</th>
          </tr>
        </thead>
        <tbody>
          {a.contractions.map((c) => (
            <tr key={c.n}>
              <td className="tn">T{c.n}</td>
              <td title={D(c.hi)}>{fmtPrice(c.high)}</td>
              <td title={D(c.lo)}>
                {fmtPrice(c.low)}
                {c.shakeout ? <sup title="A rally inside this decline retraced over half of it before the final low: a shakeout.">s</sup> : null}
              </td>
              <td className="dep">−{(c.depth * 100).toFixed(1)}%</td>
              <td>{c.end - c.hi}</td>
              <td>{Number.isFinite(c.volRatio) ? c.volRatio.toFixed(2) + "×" : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">
        Base from {D(a.base.start)}, after an advance of +{(a.base.priorAdvance * 100).toFixed(0)}%
        {a.base.priorLowIdx >= 0 ? ` from the ${D(a.base.priorLowIdx)} low` : ""}. Days run from each high to the next; volume is the average over that stretch against the 50-day average.
      </p>

      {GROUPS.map((gr) => {
        const list = a.checks.filter((c) => c.group === gr.id);
        if (!list.length) return null;
        return (
          <section key={gr.id}>
            <h3>{gr.title}</h3>
            <ul className="checks">
              {list.map((c) => (
                <li key={c.id} className={c.pass === false && c.required ? "failrow" : ""}>
                  <Mark c={c} />
                  <span className="lab">
                    {c.label}
                    {!c.required && <i> grade</i>}
                  </span>
                  <span className="val" title={"wants " + c.want}>
                    {c.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
