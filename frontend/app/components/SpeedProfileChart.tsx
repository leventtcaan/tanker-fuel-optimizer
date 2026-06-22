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
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-2">Bacak Bazında Optimize Hız (knot)</h2>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis domain={[0, "dataMax + 2"]} unit=" kn" />
          <Tooltip formatter={(value) => [`${value} kn`, "Hız"]} />
          <Bar dataKey="speed">
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.isStorm ? STORM_COLOR : CALM_COLOR}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-500 mt-2">
        Kırmızı = fırtına bacağı (yavaşla), mavi = sakin bacak.
      </p>
    </div>
  );
}
