import React from "react";
import { Callout } from "./components.jsx";

const Term = ({ word, children }) => (
  <div className="term"><dt>{word}</dt><dd>{children}</dd></div>
);

export default function Guide({ meta }) {
  const cutoff = meta?.default_cutoff ?? "09:00";
  return (
    <div className="guide">
      <section className="panel">
        <h2>What is this for?</h2>
        <p>
          Every morning, a power buyer commits to buying electricity for the next day. A big unknown is how much the wind will
          produce: if there is less wind than expected, the shortfall has to be bought at short notice.
          This page set answers two plain questions:
        </p>
        <ol>
          <li><b>Plan page:</b> What does the latest wind forecast say for tomorrow, and how much extra should I keep in reserve?</li>
          <li><b>Accuracy page:</b> How far off has that forecast been in the past?</li>
        </ol>
        <p>
          Think of it like a weather forecast that comes with a margin of error. A forecast of “10°C” is more useful when you also know
          it is usually right to within 2 degrees.
        </p>
      </section>

      <section className="panel">
        <h2>Using the Plan page in three steps</h2>
        <ol>
          <li><b>Pick the day you are buying for.</b> We then choose the newest forecast that was published before your decide-by time
            (currently {cutoff} UK time the day before). Anything published later is ignored, so nothing here relies on hindsight.</li>
          <li><b>Read the summary and the gauge.</b> “Expected” is what the forecast says. “Weak-wind case” is a realistic bad day.</li>
          <li><b>Look at “Extra to keep in reserve.”</b> This is how far below the forecast the wind has fallen in the past, apart from
            the rare worst cases. Keeping that much extra covers you on a weak-wind day.</li>
        </ol>
        <Callout title="About the decide-by time">
          {cutoff} is our working assumption, not an official deadline. Great Britain has more than one day-ahead market, and they close at about
          09:20 and 09:50. You can change the time in the controls to match yours.
        </Callout>
      </section>

      <section className="panel">
        <h2>Words explained</h2>
        <dl>
          <Term word="MW and GW">Units of electrical power. 1 GW is 1,000 MW. The numbers on screen are written out in full so you can read them directly.</Term>
          <Term word="Forecast">What was predicted for each hour, using the newest forecast available at your decide-by time.</Term>
          <Term word="What actually happened">The wind power really recorded for that hour afterwards.</Term>
          <Term word="Miss (error)">The forecast minus what happened. A plus sign means the forecast promised more wind than there was, so you would be short.
            A minus sign means there was more wind than forecast.</Term>
          <Term word="Typical miss (MAE)">The average size of the miss, ignoring the direction. Like the average error of a tape measure.</Term>
          <Term word="Miss as a share of wind (MAPE)">The typical miss compared with how much wind there actually was. Hours with no wind at all are left out, because a share of zero is meaningless.</Term>
          <Term word="Bad-hour miss (90th percentile)">9 hours in 10 had a smaller miss than this. Good for planning for a bad day.</Term>
          <Term word="Worst-case miss (99th percentile)">99 hours in 100 had a smaller miss than this. With only one month of data this rests on a handful of hours.</Term>
          <Term word="Leans high or low (bias)">The average of the signed misses. If it is well above zero, the forecast tends to promise more than arrives.</Term>
          <Term word="Usual range of misses">The middle stretch of past misses (8 hours in 10 by default). We lay it around the forecast to show where wind usually ends up.</Term>
          <Term word="Hours ahead">How long before the hour in question the forecast was issued. Later forecasts are usually better.</Term>
        </dl>
      </section>

      <section className="panel">
        <h2>Limits to keep in mind</h2>
        <ul>
          <li><b>The forecast is hourly; the records are every half hour.</b> We compare only the hours where both exist and never invent values in between.</li>
          <li><b>One month is a small sample.</b> The usual range is worked out from the same month it is judged on, which makes it a little optimistic. The “only days already known” option removes that.</li>
          <li><b>Two records of real wind disagree.</b> The wind record used here reads about 19% (roughly 2.2 GW) lower than Elexon’s other record. Against this record the forecast looks about
            1.7 GW too high; against the other, it is about 0.4 GW too low. Treat “leans high” as largely a record-keeping difference, not proof of a bad forecast.
            The Accuracy page repeats this warning next to the figure.</li>
          <li><b>This is decision support, not trading advice.</b></li>
        </ul>
      </section>
    </div>
  );
}
