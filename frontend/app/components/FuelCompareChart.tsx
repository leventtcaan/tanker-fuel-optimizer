"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Props = {
  baselineFuel: number;
  optimizedFuel: number;
  savingPct: number;
};

const BASELINE_COLOR = "#9ca3af"; // gray: constant-speed baseline
const OPTIMIZED_COLOR = "#22c55e"; // green: optimized (less fuel)

type FuelDatum = { name: string; fuel: number; color: string };

// Themed tooltip card (matches our dark panels), replacing the washed-out default.
function FuelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: FuelDatum }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-0.5">{d.name}</p>
      <p>
        Yakıt:{" "}
        <span className="font-medium">
          {Math.round(d.fuel).toLocaleString("tr-TR")} t
        </span>
      </p>
    </div>
  );
}

/**
 * Two-bar comparison of voyage fuel: constant service speed vs the optimized
 * speed profile. The saving percentage is shown as a caption below the chart.
 */
export default function FuelCompareChart({
  baselineFuel,
  optimizedFuel,
  savingPct,
}: Props) {
  const data: FuelDatum[] = [
    { name: "Sabit Hız", fuel: Number(baselineFuel.toFixed(2)), color: BASELINE_COLOR },
    { name: "Optimize", fuel: Number(optimizedFuel.toFixed(2)), color: OPTIMIZED_COLOR },
  ];

  return (
    <div className="pruva-card p-4">
      <h2 className="font-semibold mb-2">Yakıt Karşılaştırması (ton)</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            unit=" t"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          {/* cursor={false} kills the gray "ghost" highlight rect on hover. */}
          <Tooltip content={<FuelTooltip />} cursor={false} />
          <Bar dataKey="fuel" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-sm font-medium text-[var(--accent)] mt-2">
        Yakıt tasarrufu: %{savingPct.toFixed(1)}
      </p>
    </div>
  );
}
