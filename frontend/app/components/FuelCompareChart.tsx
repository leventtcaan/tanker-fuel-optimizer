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

/**
 * Two-bar comparison of voyage fuel: constant service speed vs the optimized
 * speed profile. The saving percentage is shown as a caption below the chart.
 */
export default function FuelCompareChart({
  baselineFuel,
  optimizedFuel,
  savingPct,
}: Props) {
  const data = [
    { name: "Sabit Hız", fuel: Number(baselineFuel.toFixed(2)), color: BASELINE_COLOR },
    { name: "Optimize", fuel: Number(optimizedFuel.toFixed(2)), color: OPTIMIZED_COLOR },
  ];

  return (
    <div className="pruva-card p-4">
      <h2 className="font-semibold mb-2">Yakıt Karşılaştırması (ton)</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f3a57" />
          <XAxis dataKey="name" tick={{ fill: "#93a7bd", fontSize: 12 }} />
          <YAxis unit=" t" tick={{ fill: "#93a7bd", fontSize: 12 }} />
          <Tooltip
            formatter={(value) => [`${value} t`, "Yakıt"]}
            contentStyle={{ background: "#13283f", border: "1px solid #1f3a57", color: "#e6eef6" }}
          />
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
