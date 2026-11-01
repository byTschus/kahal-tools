/** Einfaches gestapeltes Säulendiagramm (SVG, ohne Abhängigkeiten) */
export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export function BarChart({ data, series, height = 240 }: { data: { label: string; values: Record<string, number> }[]; series: BarSeries[]; height?: number }) {
  if (!data.length) return <div className="empty">Keine Daten im gewählten Zeitraum</div>;
  const totals = data.map((d) => series.reduce((s, ser) => s + (d.values[ser.key] ?? 0), 0));
  const maxVal = Math.max(1, ...totals);
  const step = niceStep(maxVal);
  const top = Math.ceil(maxVal / step) * step;
  const barW = 26;
  const gap = 12;
  const left = 40;
  const bottom = 46;
  const width = Math.max(400, left + data.length * (barW + gap) + gap);
  const plotH = height - bottom - 10;
  const y = (v: number) => 10 + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chart">
        <svg width={width} height={height} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width} y1={y(t)} y2={y(t)} stroke="var(--border)" />
              <text x={left - 6} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = left + gap + i * (barW + gap);
            let acc = 0;
            return (
              <g key={i}>
                <title>
                  {d.label}: {series.map((s) => `${s.label} ${d.values[s.key] ?? 0}`).join(', ')} (Total {totals[i]})
                </title>
                {series.map((s) => {
                  const v = d.values[s.key] ?? 0;
                  const y1 = y(acc + v);
                  const h = y(acc) - y1;
                  acc += v;
                  return v > 0 ? <rect key={s.key} x={x} y={y1} width={barW} height={Math.max(0, h - 1)} style={{ fill: s.color }} rx={3} /> : null;
                })}
                <text x={x + barW / 2} y={height - bottom + 14} textAnchor="end" transform={`rotate(-40 ${x + barW / 2} ${height - bottom + 14})`}>
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend">
        {series.map((s) => (
          <span key={s.key} style={{ ['--c' as string]: s.color }}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
