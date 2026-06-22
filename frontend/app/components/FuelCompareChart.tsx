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
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-2">Yakıt Karşılaştırması (ton)</h2>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis unit=" t" />
          <Tooltip formatter={(value) => [`${value} t`, "Yakıt"]} />
          <Bar dataKey="fuel">
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-sm font-medium text-green-700 mt-2">
        Yakıt tasarrufu: %{savingPct.toFixed(1)}
      </p>
    </div>
  );
}
