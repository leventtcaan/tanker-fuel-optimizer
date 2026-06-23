"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
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

type LegWeather = {
  factor: number;
  wave_m: number | null;
  source: string;
  beaufort?: number;
  wind_ms?: number | null;
  wind_dir?: number | null;
  theta_deg?: number | null;
};

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
// Vessel inputs for the log-linear fuel model (F1).
const DEFAULT_DRAFT_DM = 12.0;
const DEFAULT_DAYS_SINCE_DD = 180;
const DEFAULT_LOAD = 0.5;
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

// Arrow pointing where the wind is blowing TOWARD (Open-Meteo gives the FROM
// direction, so we add 180°). Used as a compact per-leg wind indicator.
const WIND_ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
const windArrow = (fromDeg: number) =>
  WIND_ARROWS[Math.round((((fromDeg + 180) % 360) / 45)) % 8];

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
    <div className="border-b border-[var(--border)] last:border-b-0 py-2.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm font-semibold text-[var(--text)]"
      >
        <span>{title}</span>
        <span className="text-[var(--muted)]">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-2.5 space-y-2.5">{children}</div>}
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
  // Vessel inputs feeding the log-linear fuel formula (draft, fouling, load).
  const [draftDm, setDraftDm] = useState(DEFAULT_DRAFT_DM);
  const [daysSinceDrydock, setDaysSinceDrydock] = useState(DEFAULT_DAYS_SINCE_DD);
  const [load, setLoad] = useState(DEFAULT_LOAD);
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

  // Click-to-pick mode: clicking the map snaps the chosen endpoint to the
  // nearest named port. "off" disables map clicks (default).
  const [pickMode, setPickMode] = useState<"off" | "origin" | "dest">("off");

  // Fire one automatic optimize on first load (once both default ports +
  // route_info have resolved) so the map and results are never empty. This ref
  // guards it so it never re-runs when the user later changes ports.
  const didAutoRun = useRef(false);

  // Snap a clicked map point to the nearest named port (GET /ports/nearest) and
  // set it as the active endpoint (Kalkış or Varış).
  async function handleMapPick(lat: number, lon: number) {
    if (pickMode === "off") return;
    try {
      const res = await fetch(
        `${API}/ports/nearest?lat=${lat}&lon=${lon}`
      );
      if (!res.ok) throw new Error();
      const port: Port = await res.json();
      if (pickMode === "origin") setOriginPort(port);
      else setDestPort(port);
    } catch {
      setError("En yakın liman bulunamadı");
    }
  }

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
          // First load only: auto-optimize with the just-computed ETA so the
          // map draws a route and the right panel shows results immediately.
          if (!didAutoRun.current) {
            didAutoRun.current = true;
            handleOptimize(info.suggested_eta_h);
          }
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
        draft_dm: draftDm,
        days_since_drydock: daysSinceDrydock,
        load,
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
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_400px] gap-3 p-3">
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
            {/* Vessel inputs for the log-linear fuel formula (F1). */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="pruva-label">Draft Dm (m)</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={draftDm}
                  onChange={(e) => setDraftDm(Number(e.target.value))}
                  className="pruva-input"
                />
              </div>
              <div>
                <label className="pruva-label">Drydock&apos;tan gün</label>
                <input
                  type="number"
                  min={0}
                  value={daysSinceDrydock}
                  onChange={(e) => setDaysSinceDrydock(Number(e.target.value))}
                  className="pruva-input"
                />
              </div>
            </div>
            <div>
              <label className="pruva-label">
                Yük oranı: {load.toFixed(2)} (0 balast → 1 tam yük)
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={load}
                onChange={(e) => setLoad(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </div>
          </Section>

          <Section title="Hava" defaultOpen={false}>
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
                      Bacak {i + 1}:{" "}
                      {lw.wave_m != null ? `${lw.wave_m} m dalga` : "veri yok"}
                      {lw.beaufort != null && (
                        <span className="text-[var(--text)]">
                          {" · "}Bft {lw.beaufort}
                          {lw.wind_dir != null && ` ${windArrow(lw.wind_dir)}`}
                        </span>
                      )}
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

          <Section title="Ekonomi" defaultOpen={false}>
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
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[#04201c] font-semibold px-4 py-2.5 hover:opacity-90 disabled:opacity-50"
          >
            {loading && (
              <span className="inline-block w-4 h-4 border-2 border-[#04201c] border-t-transparent rounded-full animate-spin" />
            )}
            {loading ? "Hesaplanıyor..." : "Optimize Et"}
          </button>

          {error && <p className="mt-3 text-sm text-[var(--grade-e)]">Hata: {error}</p>}
        </div>

        {/* CENTER: the hero map — large, fills the viewport height on desktop. */}
        <div className="lg:h-[calc(100vh-6rem)] min-h-[480px] flex flex-col gap-2">
          {/* Click-to-pick mode toggle: snap a map click to the nearest port. */}
          <div className="pruva-card p-2 flex items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">Haritadan seç:</span>
            {([
              ["origin", "Kalkış"],
              ["dest", "Varış"],
              ["off", "Kapalı"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setPickMode(mode)}
                className={`rounded-lg px-3 py-1 font-medium border ${
                  pickMode === mode
                    ? "bg-[var(--accent)] text-[#04201c] border-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
                }`}
              >
                {label}
              </button>
            ))}
            {pickMode !== "off" && (
              <span className="ml-auto text-xs text-[var(--accent)]">
                Haritaya tıklayın → en yakın liman {pickMode === "origin" ? "kalkış" : "varış"} olur
              </span>
            )}
          </div>

          <div className="flex-1 min-h-[460px]">
            <RouteMap
              routeCoords={routeCoords}
              originName={originPort ? titleCase(originPort.name) : undefined}
              destName={destPort ? titleCase(destPort.name) : undefined}
              legsWeather={result?.legs_weather ?? null}
              pickMode={pickMode}
              onMapPick={handleMapPick}
            />
          </div>
        </div>

        {/* RIGHT: results */}
        <div className="space-y-3 self-start">
          {/* Resting state before any result: skeletons while the first auto-run
              is loading, otherwise a compact "how it works" card. Keeps the
              right column from ever looking blank on first load. */}
          {!result && loading && (
            <div className="space-y-4 animate-pulse">
              <div className="pruva-card p-5">
                <div className="h-3 w-24 rounded bg-[var(--border)]" />
                <div className="mt-3 h-9 w-40 rounded bg-[var(--border)]" />
                <div className="mt-2 h-3 w-48 rounded bg-[var(--border)]" />
              </div>
              <div className="pruva-card p-4 space-y-2">
                <div className="h-3 w-28 rounded bg-[var(--border)]" />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-3 w-full rounded bg-[var(--border)]" />
                ))}
              </div>
              <div className="pruva-card h-28" />
            </div>
          )}

          {!result && !loading && (
            <div className="pruva-card p-5 text-sm">
              <h2 className="font-semibold mb-2">Nasıl çalışır</h2>
              <ol className="space-y-1.5 text-[var(--muted)] list-decimal list-inside">
                <li>Kalkış ve varış limanını seçin (veya haritadan tıklayın).</li>
                <li>Gerçek deniz rotası çizilir, canlı hava ile bacaklara bölünür.</li>
                <li>Hız profili optimize edilir; yakıt, CO₂, maliyet ve CII notu hesaplanır.</li>
              </ol>
              <p className="mt-3 text-xs text-[var(--muted)]">
                İstanbul → Singapur ile başlıyoruz. Ayarları değiştirip{" "}
                <span className="text-[var(--accent)] font-semibold">Optimize Et</span>{" "}
                ile yeniden hesaplayın.
              </p>
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
