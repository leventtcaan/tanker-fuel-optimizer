"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SpeedProfileChart from "./components/SpeedProfileChart";
import FuelCompareChart from "./components/FuelCompareChart";
import CiiBadge from "./components/CiiBadge";

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
  fuel_cost_usd: number;
  ets_cost_eur: number;
  eca_nm: number;
  non_eca_nm: number;
  blended_fuel_cost_usd: number;
};

type EcaZone = { name: string; bbox: number[] };

type OptimizeResponse = {
  baseline: ScenarioOut;
  optimized: ScenarioOut;
  saving_pct: number;
  co2_saved_t: number;
  money_saved_usd: number;
  distance_nm: number;
  route_coords: number[][] | null;
  eca_zones: EcaZone[] | null;
};

const API = process.env.NEXT_PUBLIC_API_URL;

// The route is resampled into this many legs server-side.
const NUM_LEGS = 6;

// Defaults. Gibraltar -> İzmir (Aliağa) is ~1646 nm; at a 130 h budget the ship
// must slow below service speed, producing the baseline E -> optimized C jump.
const DEFAULT_ORIGIN = "Gibraltar";
const DEFAULT_DEST = "İzmir (Aliağa)";
const DEFAULT_ETA = 130;
const DEFAULT_DWT = 40000;
const DEFAULT_SERVICE_SPEED = 14.0;
const DEFAULT_YEAR = 2026;
const YEARS = [2023, 2024, 2025, 2026];

// Economics defaults (editable REFERENCE prices, mirrored from the backend; the
// /prices endpoint overwrites these on load when reachable).
const FUEL_TYPES = ["VLSFO", "LSMGO", "HSFO"];
const DEFAULT_FUEL_PRICES: Record<string, number> = {
  VLSFO: 586.0,
  LSMGO: 737.0,
  HSFO: 435.0,
};
const DEFAULT_ETS_PRICE = 85.0;

export default function Home() {
  // Port list for the dropdowns (fetched from the backend).
  const [ports, setPorts] = useState<string[]>([]);

  // Voyage controls (form state).
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [dest, setDest] = useState(DEFAULT_DEST);
  // ETA range is wide (50-800 h): real routes span from ~240 nm to ~6000 nm, so
  // the time budget must scale far beyond the old Mediterranean-only range.
  const [berthEta, setBerthEta] = useState(DEFAULT_ETA);
  const [dwt, setDwt] = useState(DEFAULT_DWT);
  const [serviceSpeed, setServiceSpeed] = useState(DEFAULT_SERVICE_SPEED);
  const [year, setYear] = useState(DEFAULT_YEAR);
  // One weather factor per resampled leg; >1.0 marks rougher water.
  const [weather, setWeather] = useState<number[]>(Array(NUM_LEGS).fill(1.0));

  // Economics controls (editable reference prices, not live).
  const [fuelType, setFuelType] = useState("VLSFO");
  const [fuelPrices, setFuelPrices] = useState<Record<string, number>>(DEFAULT_FUEL_PRICES);
  const [etsPrice, setEtsPrice] = useState(DEFAULT_ETS_PRICE);
  const [euScopeFraction, setEuScopeFraction] = useState(0.0);

  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the port list once on mount.
  useEffect(() => {
    fetch(`${API}/ports`)
      .then((r) => r.json())
      .then((list: string[]) => setPorts(list))
      .catch(() => setError("Liman listesi yüklenemedi"));
  }, []);

  // Load reference prices once on mount; fall back to defaults on failure.
  useEffect(() => {
    fetch(`${API}/prices`)
      .then((r) => r.json())
      .then((p: { fuel_prices_usd_per_t: Record<string, number>; ets_eur_per_tco2: number }) => {
        if (p.fuel_prices_usd_per_t) setFuelPrices(p.fuel_prices_usd_per_t);
        if (typeof p.ets_eur_per_tco2 === "number") setEtsPrice(p.ets_eur_per_tco2);
      })
      .catch(() => {
        /* keep the reference defaults */
      });
  }, []);

  // Edit the price of the currently-selected fuel type.
  function setSelectedFuelPrice(value: number) {
    setFuelPrices((prev) => ({ ...prev, [fuelType]: value }));
  }

  // Minimal legs (weather only) for coloring the speed-profile chart bars; the
  // real distances live server-side and aren't needed for the chart.
  const legsForChart = useMemo(
    () => weather.map((w) => ({ distance_nm: 0, weather: w })),
    [weather]
  );

  function setLegWeather(index: number, value: number) {
    setWeather((prev) => prev.map((w, i) => (i === index ? value : w)));
  }

  async function handleOptimize() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        origin,
        dest,
        num_legs: NUM_LEGS,
        weather,
        dwt,
        service_speed: serviceSpeed,
        berth_eta_h: berthEta,
        year,
        fuel_type: fuelType,
        fuel_prices: fuelPrices,
        ets_price: etsPrice,
        eu_scope_fraction: euScopeFraction,
      };
      const res = await fetch(`${API}/optimize`, {
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

  const routeCoords = (result?.route_coords ?? []) as [number, number][];

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Tanker Yakıt Optimizasyonu</h1>
      <p className="text-sm text-gray-600 mb-6">
        Gerçek deniz rotası (limandan limana). Kalkış/varış seçip optimize edin.
      </p>

      {/* Controls panel */}
      <div className="border rounded p-4 space-y-4 mb-6">
        {/* Port dropdowns */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Kalkış</label>
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="w-full border rounded px-2 py-1"
            >
              {ports.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Varış</label>
            <select
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              className="w-full border rounded px-2 py-1"
            >
              {ports.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Berth ETA: number input + range slider stay in sync. */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Liman Varış Süresi (saat): {berthEta}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={50}
              max={800}
              step={5}
              value={berthEta}
              onChange={(e) => setBerthEta(Number(e.target.value))}
              className="flex-1"
            />
            <input
              type="number"
              min={50}
              max={800}
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

        {/* Per-leg weather sliders (one per resampled leg). */}
        <div>
          <label className="block text-sm font-medium mb-1">
            Bacak Bazında Hava (1.0 sakin → 1.6 fırtına)
          </label>
          <div className="grid grid-cols-2 gap-2">
            {weather.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm w-16">Bacak {i + 1}</span>
                <input
                  type="range"
                  min={1.0}
                  max={1.6}
                  step={0.1}
                  value={w}
                  onChange={(e) => setLegWeather(i, Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm w-8 text-right">{w.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Economics controls (reference prices, editable — NOT live quotes). */}
        <div className="border-t pt-3">
          <h3 className="text-sm font-semibold mb-2">Ekonomi</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Yakıt Tipi</label>
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                className="w-full border rounded px-2 py-1"
              >
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {fuelType} Referans Fiyat (düzenlenebilir, $/ton)
              </label>
              <input
                type="number"
                min={0}
                value={fuelPrices[fuelType] ?? 0}
                onChange={(e) => setSelectedFuelPrice(Number(e.target.value))}
                className="w-full border rounded px-2 py-1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                ETS Referans Fiyat (€/tCO2)
              </label>
              <input
                type="number"
                min={0}
                value={etsPrice}
                onChange={(e) => setEtsPrice(Number(e.target.value))}
                className="w-full border rounded px-2 py-1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                AB ETS Kapsam Oranı (0–1)
              </label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={euScopeFraction}
                onChange={(e) => setEuScopeFraction(Number(e.target.value))}
                className="w-full border rounded px-2 py-1"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Fiyatlar referanstır, canlı değildir; düzenleyebilirsiniz.
          </p>
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
        {/* Map: the real sea lane + ECA boxes, drawn from the response. */}
        <RouteMap
          routeCoords={routeCoords}
          originName={origin}
          destName={dest}
          ecaZones={result?.eca_zones ?? []}
        />

        {result && (
          <>
            {/* ECA context: the Med has been a 0.1% sulphur ECA since May 2025,
                so compliant fuel (VLSFO/MGO) is expensive there — burning less
                of it through optimization saves more money and emissions. */}
            <p className="text-sm text-gray-600">
              Akdeniz ECA bölgesinde (2025&apos;ten beri %0.1 kükürt sınırı)
              uyumlu yakıt pahalı; bu yüzden daha az yakıt yakmak hem maliyeti
              hem emisyonu ciddi düşürür.
            </p>

            <p className="text-sm text-gray-700">
              Toplam mesafe: {result.distance_nm.toFixed(0)} deniz mili
            </p>

            {result.baseline.eca_nm > 0 && (
              <p className="text-sm text-green-700">
                Rotanın {result.baseline.eca_nm.toFixed(0)} nm&apos;si ECA içinde
                (düşük kükürt zorunlu, pahalı yakıt)
              </p>
            )}

            {/* Phase 5b: visual charts of the same result. */}
            <SpeedProfileChart legs={legsForChart} speeds={result.optimized.speeds} />
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
              <p>
                Yakıt Maliyeti: $
                {Math.round(
                  result.baseline.eca_nm > 0
                    ? result.baseline.blended_fuel_cost_usd
                    : result.baseline.fuel_cost_usd
                ).toLocaleString()}
                {result.baseline.eca_nm > 0 ? " (ECA karışık yakıt)" : ""}
              </p>
              {euScopeFraction > 0 && (
                <p>ETS Maliyeti: €{result.baseline.ets_cost_eur.toLocaleString()}</p>
              )}
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
              <p>
                Yakıt Maliyeti: $
                {Math.round(
                  result.optimized.eca_nm > 0
                    ? result.optimized.blended_fuel_cost_usd
                    : result.optimized.fuel_cost_usd
                ).toLocaleString()}
                {result.optimized.eca_nm > 0 ? " (ECA karışık yakıt)" : ""}
              </p>
              {euScopeFraction > 0 && (
                <p>ETS Maliyeti: €{result.optimized.ets_cost_eur.toLocaleString()}</p>
              )}
            </div>

            <div className="border rounded p-4 bg-green-50">
              <p>Yakıt Tasarrufu: {result.saving_pct.toFixed(1)}%</p>
              <p>CO2 Tasarrufu: {result.co2_saved_t.toFixed(2)} ton</p>
              <p className="font-semibold">
                Para Tasarrufu: ${Math.round(result.money_saved_usd).toLocaleString()}
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
