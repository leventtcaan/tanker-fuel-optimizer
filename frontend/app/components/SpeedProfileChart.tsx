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

// One leg of the voyage; weather > 1.0 marks rougher water (a storm).
type Leg = { distance_nm: number; weather: number };

type Props = {
  legs: Leg[];
  speeds: number[] | null;
};

const STORM_COLOR = "#ef4444"; // red-ish: storm leg (weather > 1.0)
const CALM_COLOR = "#3b82f6"; // blue-ish: calm leg

/**
 * Bar chart of the optimized speed per leg. Storm legs (weather > 1.0) are
 * colored red so it is visible that the optimizer slows down where the weather
 * penalty makes fuel most expensive.
 */
export default function SpeedProfileChart({ legs, speeds }: Props) {
  if (!speeds) return null;

  // Pair each leg's optimized speed with its weather, so we can color by storm.
  const data = speeds.map((speed, i) => ({
    name: `Bacak ${i + 1}`,
    speed: Number(speed.toFixed(2)),
    isStorm: (legs[i]?.weather ?? 1.0) > 1.0,
  }));

  return (
    <div className="pruva-card p-4">
      <h2 className="font-semibold mb-2">Bacak Bazında Optimize Hız (knot)</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f3a57" />
          <XAxis dataKey="name" tick={{ fill: "#93a7bd", fontSize: 12 }} />
          <YAxis
            domain={[0, "dataMax + 2"]}
            unit=" kn"
            tick={{ fill: "#93a7bd", fontSize: 12 }}
          />
          <Tooltip
            formatter={(value) => [`${value} kn`, "Hız"]}
            contentStyle={{ background: "#13283f", border: "1px solid #1f3a57", color: "#e6eef6" }}
          />
          <Bar dataKey="speed" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.isStorm ? STORM_COLOR : CALM_COLOR}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-[var(--muted)] mt-2">
        Kırmızı = fırtına bacağı (yavaşla), mavi = sakin bacak.
      </p>
    </div>
  );
}
