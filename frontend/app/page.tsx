"use client";

import { useState } from "react";
import SpeedProfileChart from "./components/SpeedProfileChart";
import FuelCompareChart from "./components/FuelCompareChart";
import CiiBadge from "./components/CiiBadge";

// Hardcoded 3-leg storm voyage (matches the backend test scenario).
const PAYLOAD = {
  legs: [
    { distance_nm: 700, weather: 1.0 },
    { distance_nm: 700, weather: 1.4 },
    { distance_nm: 700, weather: 1.0 },
  ],
  dwt: 40000,
  service_speed: 14.0,
  berth_eta_h: 175.0,
  year: 2026,
};

// Response shape returned by POST /optimize.
type ScenarioOut = {
  fuel_t: number;
  total_time_h: number;
  attained_cii: number;
  cii_ratio: number;
  cii_grade: string;
  speeds: number[] | null;
};

type OptimizeResponse = {
  baseline: ScenarioOut;
  optimized: ScenarioOut;
  saving_pct: number;
  co2_saved_t: number;
  distance_nm: number;
};

export default function Home() {
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOptimize() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(PAYLOAD),
      });
      if (!res.ok) {
        throw new Error(`Sunucu hatası: ${res.status}`);
      }
      const data: OptimizeResponse = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen bir hata oluştu");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Tanker Yakıt Optimizasyonu</h1>
      <p className="text-sm text-gray-600 mb-6">
        3 bacaklı sefer (ortada fırtına). Optimize etmek için butona basın.
      </p>

      <button
        onClick={handleOptimize}
        disabled={loading}
        className="rounded bg-blue-600 text-white px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Hesaplanıyor..." : "Optimize Et"}
      </button>

      {error && (
        <p className="mt-4 text-red-600">Hata: {error}</p>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="border rounded p-4">
            <h2 className="font-semibold mb-2">Baz Senaryo (sabit hız)</h2>
            <p>Yakıt: {result.baseline.fuel_t.toFixed(2)} ton</p>
            <p>CII Notu: {result.baseline.cii_grade}</p>
          </div>

          <div className="border rounded p-4">
            <h2 className="font-semibold mb-2">Optimize Senaryo</h2>
            <p>Yakıt: {result.optimized.fuel_t.toFixed(2)} ton</p>
            <p>CII Notu: {result.optimized.cii_grade}</p>
            <p>
              Bacak Hızları:{" "}
              {result.optimized.speeds
                ? result.optimized.speeds.map((s) => s.toFixed(2)).join(", ") + " knot"
                : "-"}
            </p>
          </div>

          <div className="border rounded p-4 bg-green-50">
            <p>Yakıt Tasarrufu: {result.saving_pct.toFixed(1)}%</p>
            <p>CO2 Tasarrufu: {result.co2_saved_t.toFixed(2)} ton</p>
          </div>

          {/* Phase 5b: visual charts of the same result */}
          <SpeedProfileChart legs={PAYLOAD.legs} speeds={result.optimized.speeds} />
          <FuelCompareChart
            baselineFuel={result.baseline.fuel_t}
            optimizedFuel={result.optimized.fuel_t}
            savingPct={result.saving_pct}
          />
          <CiiBadge
            baselineGrade={result.baseline.cii_grade}
            optimizedGrade={result.optimized.cii_grade}
          />
        </div>
      )}
    </main>
  );
}
