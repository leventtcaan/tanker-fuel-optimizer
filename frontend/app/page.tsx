"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SpeedProfileChart from "./components/SpeedProfileChart";
import FuelCompareChart from "./components/FuelCompareChart";
import CiiBadge from "./components/CiiBadge";
import { buildLegs, WAYPOINTS } from "./lib/voyageRoute";

// CRITICAL: Leaflet touches window/document at import time, which throws under
// Next's server-side rendering. Load the map client-side only (ssr: false).
const RouteMap = dynamic(() => import("./components/RouteMap"), { ssr: false });

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

// Defaults. berth_eta_h defaults to 130 h (not the route's loose ~175 h): the
// real haversine Med route is ~1606 nm, so a tight ETA forces the ship to spend
// its time budget wisely — slow on calm legs, even slower on the storm leg
// (weather redistribution). Measured against the backend: 128 h lands on grade
// D; 130 h is the threshold where the baseline E -> optimized C jump reappears
// (~22% fuel saving, speeds ~12.6 / 11.3 / 12.6 kn). Hence 130, not 128.
const DEFAULT_ETA = 130;
const DEFAULT_DWT = 40000;
const DEFAULT_SERVICE_SPEED = 14.0;
const DEFAULT_YEAR = 2026;
const DEFAULT_WEATHER = [1.0, 1.4, 1.0];
const YEARS = [2023, 2024, 2025, 2026];

export default function Home() {
  // Voyage controls (form state).
  const [berthEta, setBerthEta] = useState(DEFAULT_ETA);
  const [dwt, setDwt] = useState(DEFAULT_DWT);
  const [serviceSpeed, setServiceSpeed] = useState(DEFAULT_SERVICE_SPEED);
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [weather, setWeather] = useState<number[]>(DEFAULT_WEATHER);

  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Legs are derived from the route geometry + the current per-leg weather, so
  // the map colors and the optimized legs always describe the SAME voyage.
  const legs = useMemo(() => buildLegs(weather), [weather]);

  // Update the weather of a single leg without mutating state.
  function setLegWeather(index: number, value: number) {
    setWeather((prev) => prev.map((w, i) => (i === index ? value : w)));
  }

  async function handleOptimize() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        legs,
        dwt,
        service_speed: serviceSpeed,
        berth_eta_h: berthEta,
        year,
      };
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        Akdeniz rotası (Cebelitarık → Aliağa). Sefer ayarlarını değiştirip
        optimize edin.
      </p>

      {/* Controls panel */}
      <div className="border rounded p-4 space-y-4 mb-6">
        {/* Berth ETA: number input + range slider stay in sync. */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Liman Varış Süresi (saat): {berthEta}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={110}
              max={175}
              step={1}
              value={berthEta}
              onChange={(e) => setBerthEta(Number(e.target.value))}
              className="flex-1"
            />
            <input
              type="number"
              min={110}
              max={175}
              value={berthEta}
              onChange={(e) => setBerthEta(Number(e.target.value))}
              className="w-24 border rounded px-2 py-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">DWT (ton)</label>
            <input
              type="number"
              min={1}
              value={dwt}
              onChange={(e) => setDwt(Number(e.target.value))}
              className="w-full border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Servis Hızı (kn)</label>
            <input
              type="number"
              step={0.1}
              value={serviceSpeed}
              onChange={(e) => setServiceSpeed(Number(e.target.value))}
              className="w-full border rounded px-2 py-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Yıl</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full border rounded px-2 py-1"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Per-leg weather sliders; feed buildLegs so the map recolors live. */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Bacak Bazında Hava (1.0 sakin → 1.6 fırtına)
          </label>
          <div className="space-y-2">
            {weather.map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm w-40">
                  Bacak {i + 1}: {WAYPOINTS[i].name} → {WAYPOINTS[i + 1].name}
                </span>
                <input
                  type="range"
                  min={1.0}
                  max={1.6}
                  step={0.1}
                  value={w}
                  onChange={(e) => setLegWeather(i, Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm w-10 text-right">{w.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleOptimize}
          disabled={loading}
          className="rounded bg-blue-600 text-white px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Hesaplanıyor..." : "Optimize Et"}
        </button>
      </div>

      {error && <p className="mt-4 text-red-600">Hata: {error}</p>}

      <div className="mt-6 space-y-4">
        {/* Map on top: the voyage route, always visible; recolors with weather. */}
        <RouteMap weather={weather} />

        {result && (
          <>
            {/* ECA context: the Med has been a 0.1% sulphur ECA since May 2025,
                so compliant fuel (VLSFO/MGO) is expensive there — burning less
                of it through optimization saves more money and emissions. */}
            <p className="text-sm text-gray-600">
              Bu rota Akdeniz ECA bölgesinde (2025&apos;ten beri %0.1 kükürt
              sınırı). Burada uyumlu yakıt pahalı; bu yüzden daha az yakıt
              yakmak hem maliyeti hem emisyonu ciddi düşürür.
            </p>

            {/* Phase 5b: visual charts of the same result. */}
            <SpeedProfileChart legs={legs} speeds={result.optimized.speeds} />
            <FuelCompareChart
              baselineFuel={result.baseline.fuel_t}
              optimizedFuel={result.optimized.fuel_t}
              savingPct={result.saving_pct}
            />
            <CiiBadge
              baselineGrade={result.baseline.cii_grade}
              optimizedGrade={result.optimized.cii_grade}
            />

            {/* Raw text fallback. */}
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
                  ? result.optimized.speeds.map((s) => s.toFixed(2)).join(", ") +
                    " knot"
                  : "-"}
              </p>
            </div>

            <div className="border rounded p-4 bg-green-50">
              <p>Yakıt Tasarrufu: {result.saving_pct.toFixed(1)}%</p>
              <p>CO2 Tasarrufu: {result.co2_saved_t.toFixed(2)} ton</p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
