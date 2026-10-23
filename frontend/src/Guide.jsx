import React from "react";

export default function Guide({ meta }) {
  const cutoff = meta?.default_cutoff ?? "09:00";
  return (
    <div className="panel guide">
      <h2 style={{ marginTop: 0 }}>What is this?</h2>
      <p>Each morning you buy power for tomorrow. Wind is the big uncertainty, so you need to know how much wind
        to expect <i>and</i> how wrong that expectation usually is. This tool shows both, using Elexon BMRS data for decisions made in January 2026 (delivery days 2 Jan – 1 Feb).</p>

      <h2>Which forecast do I see?</h2>
      <p>Elexon publishes a new national wind forecast (WINDFOR) about eight times a day. For delivery day D we use the
        <b> newest one published on or before {cutoff} UK time on D-1</b> – the forecast you actually had in hand when you
        had to decide. {cutoff} is our working assumption (GB day-ahead auctions close at about 09:20 and 09:50); change it in the controls. Anything published later is ignored, so the numbers are not flattered by hindsight.</p>

      <h2>Reading the numbers</h2>
      <dl>
        <dt>Error (forecast − actual)</dt><dd>Positive = the forecast promised more wind than arrived (you would be short). Negative = more wind than forecast.</dd>
        <dt>MAE – typical miss</dt><dd>The average size of the miss in MW, ignoring direction.</dd>
        <dt>RMSE</dt><dd>Like MAE but punishes big misses harder. If RMSE is far above MAE, there are some nasty days.</dd>
        <dt>MAPE</dt><dd>The miss as a % of actual wind. Misleading when wind is near zero, so periods with 0 MW are skipped.</dd>
        <dt>Bias – does it lean one way?</dt><dd>The average signed error. A large positive bias means the forecast is systematically too optimistic, and you should plan for less wind than it says.</dd>
        <dt>P50 / P90 / P99 absolute error</dt><dd>Half / 90% / 99% of misses are smaller than this. P90 is a good "bad day" planning number; P99 is the extreme.</dd>
        <dt>Safety band</dt><dd>The range of past errors (by default the middle 80%) laid around the forecast. Use its lower edge as a pessimistic wind case when sizing how much extra to buy.</dd>
        <dt>Horizon</dt><dd>How many hours before delivery a forecast was published. Usually later forecasts are better.</dd>
      </dl>

      <h2>Limits to keep in mind</h2>
      <ul>
        <li>Forecasts are hourly; actuals are half-hourly. We compare only the hours where both exist (the :00 half-hours) and invent no values in between.</li>
        <li>One month of data is a small sample. The default band is computed on the same January it is judged on, so it is optimistic; the "days known by cutoff" option removes that look-ahead.</li>
        <li>The actuals (FUELHH wind) read about 19% lower than Elexon's other actual-wind series (B1630). The forecast therefore looks about 1.7 GW too high against FUELHH, but only about 0.4 GW too low against B1630. Treat the bias as largely a data-definition gap, not proof of a forecast flaw. Details: docs/BIAS_FINDINGS.md.</li>
        <li>This is decision support, not a trading recommendation.</li>
      </ul>
    </div>
  );
}
