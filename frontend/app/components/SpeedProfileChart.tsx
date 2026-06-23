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

const STORM_COLOR = "#ef4444"; // red: storm leg (weather > 1.0)
const CALM_COLOR = "#2dd4bf"; // teal: calm leg (matches the UI accent)

type SpeedDatum = {
  name: string;
  speed: number;
  isStorm: boolean;
  weather: number;
};

// Themed tooltip card (matches our dark panels). Replaces Recharts' washed-out
// default so text stays legible on its background.
function SpeedTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: SpeedDatum }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--text)] px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-0.5">{d.name}</p>
      <p>
        Hız: <span className="font-medium">{d.speed.toFixed(1)} kn</span>
      </p>
      <p className="text-[var(--muted)]">
        Hava çarpanı: {d.weather.toFixed(1)}
        {d.isStorm ? " · fırtına" : ""}
      </p>
    </div>
  );
}

/**
 * Bar chart of the optimized speed per leg. Storm legs (weather > 1.0) are
 * colored red so it is visible that the optimizer slows down where the weather
 * penalty makes fuel most expensive.
 */
export default function SpeedProfileChart({ legs, speeds }: Props) {
  if (!speeds) return null;

  // Pair each leg's optimized speed with its weather, so we can color by storm
  // and surface the weather factor on hover.
  const data: SpeedDatum[] = speeds.map((speed, i) => ({
    name: `Bacak ${i + 1}`,
    speed: Number(speed.toFixed(2)),
    isStorm: (legs[i]?.weather ?? 1.0) > 1.0,
    weather: legs[i]?.weather ?? 1.0,
  }));

  return (
    <div className="pruva-card p-4">
      <h2 className="font-semibold mb-2">Bacak Bazında Optimize Hız (knot)</h2>
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
            domain={[0, "dataMax + 2"]}
            unit=" kn"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          {/* cursor={false} kills the gray "ghost" highlight rect on hover. */}
          <Tooltip content={<SpeedTooltip />} cursor={false} />
          <Bar dataKey="speed" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.isStorm ? STORM_COLOR : CALM_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-[var(--muted)] mt-2">
        Kırmızı = fırtına bacağı (yavaşla), turkuaz = sakin bacak.
      </p>
    </div>
  );
}
