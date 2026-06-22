"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SpeedProfileChart from "./components/SpeedProfileChart";
import FuelCompareChart from "./components/FuelCompareChart";
import CiiBadge from "./components/CiiBadge";
import PortCombobox, { Port, titleCase } from "./components/PortCombobox";

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
  feasible: boolean;
  min_time_h: number;
  legs_weather: LegWeather[] | null;
};

type LegWeather = { factor: number; wave_m: number | null; source: string };

const API = process.env.NEXT_PUBLIC_API_URL;

// The route is resampled into this many legs server-side.
const NUM_LEGS = 6;

// Defaults. The ETA below is only a placeholder until /route_info loads (once
// both ports are chosen) and replaces it with a route-aware, fuel-saving value
// (and sets the slider bounds so an infeasible ETA can't be chosen). Origin/dest
// default to İstanbul -> Singapore, picked from the curated /ports list on mount.
const DEFAULT_ORIGIN_MATCH = "ISTANBUL";
const DEFAULT_DEST_MATCH = "SINGAPORE";
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

// Thousands-separated integer formatting (Turkish locale).
const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR");

// Collapsible input group with a clickable header.
function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--border)] last:border-b-0 py-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm font-semibold text-[var(--text)]"
      >
        <span>{title}</span>
        <span className="text-[var(--muted)]">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

export default function Home() {
  // Selected origin/destination ports (full objects, so we have their coords).
  const [originPort, setOriginPort] = useState<Port | null>(null);
  const [destPort, setDestPort] = useState<Port | null>(null);

  // Voyage controls (form state).
  // ETA + its slider bounds are route-aware: set from /route_info so the user can
  // never pick an infeasible ETA and the default lands on a fuel-saving value.
  const [berthEta, setBerthEta] = useState(DEFAULT_ETA);
  const [etaMin, setEtaMin] = useState(50);
  const [etaMax, setEtaMax] = useState(800);
  const [minTimeH, setMinTimeH] = useState<number | null>(null);
  const [dwt, setDwt] = useState(DEFAULT_DWT);
  const [serviceSpeed, setServiceSpeed] = useState(DEFAULT_SERVICE_SPEED);
  const [year, setYear] = useState(DEFAULT_YEAR);
  // One weather factor per resampled leg; >1.0 marks rougher water.
  const [weather, setWeather] = useState<number[]>(Array(NUM_LEGS).fill(1.0));
  // When ON, per-leg factors come from live marine weather (sliders read-only).
  const [autoWeather, setAutoWeather] = useState(true);

  // Economics controls (editable reference prices, not live).
  const [fuelType, setFuelType] = useState("VLSFO");
  const [fuelPrices, setFuelPrices] = useState<Record<string, number>>(DEFAULT_FUEL_PRICES);
  const [etsPrice, setEtsPrice] = useState(DEFAULT_ETS_PRICE);
  const [euScopeFraction, setEuScopeFraction] = useState(0.0);

  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default-fill İstanbul -> Singapore from the curated /ports list on mount.
  useEffect(() => {
    fetch(`${API}/ports`)
      .then((r) => r.json())
      .then((list: Port[]) => {
        const find = (m: string) =>
          list.find((p) => p.name.toUpperCase().includes(m)) ?? null;
        setOriginPort(find(DEFAULT_ORIGIN_MATCH));
        setDestPort(find(DEFAULT_DEST_MATCH));
      })
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

  // Unambiguous "lat,lon" references for the chosen ports (70 names repeat).
  const originRef = originPort ? `${originPort.lat},${originPort.lon}` : "";
  const destRef = destPort ? `${destPort.lat},${destPort.lon}` : "";

  // Route-aware ETA defaults: once both ports are chosen (and whenever they
  // change), fetch the route's timing and set the slider bounds + a sensible
  // (fuel-saving) default ETA.
  useEffect(() => {
    if (!originRef || !destRef) return;
    const url = `${API}/route_info?origin=${encodeURIComponent(
      originRef
    )}&dest=${encodeURIComponent(destRef)}&num_legs=${NUM_LEGS}`;
    fetch(url)
      .then((r) => r.json())
      .then(
        (info: {
          min_time_h: number;
          baseline_time_h: number;
          suggested_eta_h: number;
        }) => {
          setMinTimeH(info.min_time_h);
          // Floor at the earliest feasible arrival so an infeasible ETA can't be
          // chosen; cap generously at twice the baseline time.
          setEtaMin(Math.ceil(info.min_time_h));
          setEtaMax(Math.round(info.baseline_time_h * 2));
          setBerthEta(info.suggested_eta_h);
        }
      )
      .catch(() => {
        /* keep current ETA bounds on failure */
      });
  }, [originRef, destRef]);

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

  async function handleOptimize(etaOverride?: number) {
    if (!originRef || !destRef) {
      setError("Lütfen kalkış ve varış limanı seçin");
      return;
    }
    const eta = etaOverride ?? berthEta;
    if (etaOverride !== undefined) setBerthEta(etaOverride);
    setLoading(true);
    setError(null);
    try {
      const payload = {
        origin: originRef,
        dest: destRef,
        num_legs: NUM_LEGS,
        weather,
        dwt,
        service_speed: serviceSpeed,
        berth_eta_h: eta,
        year,
        fuel_type: fuelType,
        fuel_prices: fuelPrices,
        ets_price: etsPrice,
        eu_scope_fraction: euScopeFraction,
        auto_weather: autoWeather,
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

  // Pick the meaningful fuel cost: blended when the route touches an ECA.
  const scenarioCost = (s: ScenarioOut) =>
    s.eca_nm > 0 ? s.blended_fuel_cost_usd : s.fuel_cost_usd;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Top bar: PRUVA wordmark + tagline + honest DEMO pill. */}
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-3 bg-[var(--panel)]">
        <span className="text-xl font-extrabold tracking-wide text-[var(--accent)]">
          PRUVA
        </span>
        <span className="hidden sm:inline text-sm text-[var(--muted)]">
          Akıllı Tanker Rota &amp; Yakıt Optimizasyon Platformu
        </span>
        <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border border-[var(--accent)] text-[var(--accent)]">
          DEMO
        </span>
      </header>

      {/* Responsive 3-column layout: inputs | map | results. */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_400px] gap-4 p-4">
        {/* LEFT: inputs */}
        <div className="pruva-card p-4 self-start">
          <Section title="Rota">
            <PortCombobox
              label="Kalkış"
              value={originPort}
              onSelect={setOriginPort}
            />
            <PortCombobox
              label="Varış"
              value={destPort}
              onSelect={setDestPort}
            />
          </Section>

          <Section title="Sefer">
            <div>
              <label className="pruva-label">
                Liman Varış Süresi: {berthEta} saat
              </label>
              <input
                type="range"
                min={etaMin}
                max={etaMax}
                step={1}
                value={berthEta}
                onChange={(e) => setBerthEta(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
              {minTimeH !== null && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  En erken varış: {fmt(minTimeH)} sa
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="pruva-label">Servis Hızı (kn)</label>
                <input
                  type="number"
                  step={0.1}
                  value={serviceSpeed}
                  onChange={(e) => setServiceSpeed(Number(e.target.value))}
                  className="pruva-input"
                />
              </div>
              <div>
                <label className="pruva-label">Yıl</label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="pruva-input"
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="pruva-label">DWT (ton)</label>
              <input
                type="number"
                min={1}
                value={dwt}
                onChange={(e) => setDwt(Number(e.target.value))}
                className="pruva-input"
              />
            </div>
          </Section>

          <Section title="Hava">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoWeather}
                onChange={(e) => setAutoWeather(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Otomatik Hava (canlı)
            </label>

            <label className="pruva-label">
              Bacak Bazında Hava (1.0 sakin → 1.6 fırtına)
            </label>
            {weather.map((w, i) => {
              const lw = autoWeather ? result?.legs_weather?.[i] : undefined;
              const value = lw ? lw.factor : w;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs w-16 text-[var(--muted)]">Bacak {i + 1}</span>
                  <input
                    type="range"
                    min={1.0}
                    max={1.6}
                    step={0.1}
                    value={value}
                    disabled={autoWeather}
                    onChange={(e) => setLegWeather(i, Number(e.target.value))}
                    className="flex-1 accent-[var(--accent)] disabled:opacity-60"
                  />
                  <span className="text-xs w-8 text-right">{value.toFixed(1)}</span>
                </div>
              );
            })}

            {/* Per-leg live wave height + source badge (after optimize). */}
            {autoWeather && result?.legs_weather && (
              <div className="space-y-0.5">
                {result.legs_weather.map((lw, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--muted)]">
                      Bacak {i + 1}: {lw.wave_m != null ? `${lw.wave_m} m dalga` : "veri yok"}
                    </span>
                    {lw.source === "open-meteo" ? (
                      <span className="text-[var(--accent)]">● canlı</span>
                    ) : (
                      <span className="text-[var(--muted)]">○ varsayılan</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {autoWeather && (
              <p className="text-xs text-[var(--muted)]">
                Dalga verisi: Open-Meteo Marine (canlı). Çarpan = bizim
                basitleştirilmiş eşlememiz.
              </p>
            )}
          </Section>

          <Section title="Ekonomi">
            <div>
              <label className="pruva-label">Yakıt Tipi</label>
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                className="pruva-input"
              >
                {FUEL_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="pruva-label">
                {fuelType} Referans Fiyat (düzenlenebilir, $/ton)
              </label>
              <input
                type="number"
                min={0}
                value={fuelPrices[fuelType] ?? 0}
                onChange={(e) => setSelectedFuelPrice(Number(e.target.value))}
                className="pruva-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="pruva-label">ETS (€/tCO2)</label>
                <input
                  type="number"
                  min={0}
                  value={etsPrice}
                  onChange={(e) => setEtsPrice(Number(e.target.value))}
                  className="pruva-input"
                />
              </div>
              <div>
                <label className="pruva-label">AB ETS Kapsam (0–1)</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={euScopeFraction}
                  onChange={(e) => setEuScopeFraction(Number(e.target.value))}
                  className="pruva-input"
                />
              </div>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Fiyatlar referanstır, canlı değildir; düzenleyebilirsiniz.
            </p>
          </Section>

          <button
            onClick={() => handleOptimize()}
            disabled={loading}
            className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[#04201c] font-semibold px-4 py-2.5 hover:opacity-90 disabled:opacity-50"
          >
            {loading && (
              <span className="inline-block w-4 h-4 border-2 border-[#04201c] border-t-transparent rounded-full animate-spin" />
            )}
            {loading ? "Hesaplanıyor..." : "Optimize Et"}
          </button>

          {error && <p className="mt-3 text-sm text-[var(--grade-e)]">Hata: {error}</p>}
        </div>

        {/* CENTER: the hero map — large, fills the viewport height on desktop. */}
        <div className="lg:h-[calc(100vh-6rem)] min-h-[480px]">
          <RouteMap
            routeCoords={routeCoords}
            originName={originPort ? titleCase(originPort.name) : undefined}
            destName={destPort ? titleCase(destPort.name) : undefined}
            legsWeather={result?.legs_weather ?? null}
          />
        </div>

        {/* RIGHT: results */}
        <div className="space-y-4 self-start">
          {!result && (
            <div className="pruva-card p-6 text-sm text-[var(--muted)]">
              Sonuçları görmek için sefer ayarlarını yapıp{" "}
              <span className="text-[var(--accent)] font-semibold">Optimize Et</span>{" "}
              düğmesine basın.
            </div>
          )}

          {/* Infeasible: show ONLY the warning + a one-click fix; hide all
              money/CII/charts so no misleading numbers appear. */}
          {result && !result.feasible && (
            <div
              className="rounded-xl p-4 space-y-3"
              style={{
                backgroundColor: "rgba(239,68,68,0.15)",
                border: "1px solid var(--grade-e)",
                color: "var(--grade-e)",
              }}
            >
              <p className="text-sm font-medium">
                ⚠ Bu varış süresi imkansız — gemi tam hızda bile yetişemez. En
                erken varış: {fmt(result.min_time_h)} saat.
              </p>
              <button
                onClick={() => handleOptimize(Math.ceil(result.min_time_h))}
                className="rounded-lg bg-[var(--accent)] text-[#04201c] font-semibold px-3 py-1.5 text-sm hover:opacity-90"
              >
                ETA&apos;yı uygulanabilir yap
              </button>
            </div>
          )}

          {result && result.feasible && (
            <>
              {/* Headline: money saved. Never render a negative value as a big
                  teal hero — if there's no slack to slow down, show it muted. */}
              <div className="pruva-card p-5">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  Para Tasarrufu
                </p>
                {result.money_saved_usd > 0 ? (
                  <>
                    <p className="text-4xl font-extrabold text-[var(--accent)] mt-1">
                      ${fmt(result.money_saved_usd)}
                    </p>
                    <p className="text-sm text-[var(--muted)] mt-1">
                      Yakıt tasarrufu %{result.saving_pct.toFixed(1)} · CO₂{" "}
                      {fmt(result.co2_saved_t)} t
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-semibold text-[var(--muted)] mt-1">
                      ${fmt(result.money_saved_usd)}
                    </p>
                    <p className="text-sm text-[var(--muted)] mt-1">
                      Bu ETA&apos;da yavaşlama payı yok — ETA&apos;yı artırın.
                    </p>
                  </>
                )}
              </div>

              {/* Yakıt & CII summary. */}
              <div className="pruva-card p-4 space-y-1 text-sm">
                <h2 className="font-semibold mb-2">Yakıt &amp; CII</h2>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Toplam mesafe</span>
                  <span>{fmt(result.distance_nm)} nm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Baz / Optimize yakıt</span>
                  <span>
                    {fmt(result.baseline.fuel_t)} → {fmt(result.optimized.fuel_t)} t
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Baz / Optimize maliyet</span>
                  <span>
                    ${fmt(scenarioCost(result.baseline))} → $
                    {fmt(scenarioCost(result.optimized))}
                  </span>
                </div>
                {euScopeFraction > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">ETS (baz / optimize)</span>
                    <span>
                      €{fmt(result.baseline.ets_cost_eur)} → €
                      {fmt(result.optimized.ets_cost_eur)}
                    </span>
                  </div>
                )}
                {result.baseline.eca_nm > 0 && (
                  <p className="text-[var(--grade-a)] pt-1">
                    Rotanın {fmt(result.baseline.eca_nm)} nm&apos;si ECA içinde
                    (düşük kükürt zorunlu, pahalı yakıt)
                  </p>
                )}
              </div>

              <CiiBadge
                baselineGrade={result.baseline.cii_grade}
                optimizedGrade={result.optimized.cii_grade}
              />
              <SpeedProfileChart legs={legsForChart} speeds={result.optimized.speeds} />
              <FuelCompareChart
                baselineFuel={result.baseline.fuel_t}
                optimizedFuel={result.optimized.fuel_t}
                savingPct={result.saving_pct}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
