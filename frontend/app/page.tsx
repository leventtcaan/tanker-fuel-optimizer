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

// One leg's optimized breakdown (POST /optimize -> per_leg). Carries the FUEL
// the rest of the engine already computed, plus the conditions on that leg.
type PerLeg = {
  leg_index: number;
  distance_nm: number;
  speed_kn: number;
  fuel_t: number;
  baseline_fuel_t: number;
  weather_factor: number;
  beaufort: number;
  wave_m: number;
  current_kn: number;
  sog_kn: number;
};

type OptimizeResponse = {
  baseline: ScenarioOut;
  optimized: ScenarioOut;
  saving_pct: number;
  co2_saved_t: number;
  money_saved_usd: number;
  distance_nm: number;
  num_legs: number;
  per_leg: PerLeg[] | null;
  route_coords: number[][] | null;
  eca_zones: EcaZone[] | null;
  feasible: boolean;
  min_time_h: number;
  legs_weather: LegWeather[] | null;
};

// One scored candidate route from POST /alternatives.
type AltRoute = {
  id: string;
  label: string;
  recommended: boolean;
  approx: boolean;
  feasible: boolean;
  route_coords: number[][];
  legs_weather: LegWeather[] | null;
  distance_nm: number;
  total_time_h: number;
  fuel_t: number;
  baseline_fuel_t: number;
  saving_pct: number;
  co2_saved_t: number;
  cii_grade: string;
  cii_attained: number;
  cii_ratio: number;
  baseline_cii_grade: string;
  baseline_cii_attained: number;
  baseline_cii_ratio: number;
  cost_usd: number;
  baseline_cost_usd: number;
  money_saved_usd: number;
  money_vs_shortest: number;
  speeds: number[] | null;
  eca_nm: number;
  crosses_hra: boolean;
  min_time_h: number;
};

// Fleet dropdown entry (GET /vessels) and live AIS detail (GET /vessels/{imo}).
type VesselListItem = { imo: number; name: string };
type VesselData = {
  imo: number;
  name: string;
  available: boolean;
  reason?: string;
  speed_kn?: number | null;
  course?: number | null;
  heading?: number | null;
  nav_status?: number | null;
  lat?: number | null;
  lon?: number | null;
  draught_m?: number | null;
  dwt?: number | null;
  destination?: string | null;
  eta?: string | null;
};

type LegWeather = {
  factor: number;
  wave_m: number | null;
  source: string;
  beaufort?: number;
  wind_ms?: number | null;
  wind_dir?: number | null;
  theta_deg?: number | null;
  current_kn?: number | null;
  current_dir?: number | null;
  sog_kn?: number | null;
};

const API = process.env.NEXT_PUBLIC_API_URL;

// Initial leg count before a route loads. The real count is distance-based and
// comes back from /route_info (~1 leg per 500 nm, clamped 3..12); we no longer
// force a fixed count on the backend, so long voyages get finer segmentation.
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
// Days since drydock above which we advise hull cleaning (display-only advisory;
// days_since_drydock is the single fouling driver, also used as idle/anchor days).
const HULL_CLEAN_THRESHOLD = 25;

// Economics defaults (editable REFERENCE prices, mirrored from the backend; the
// /prices endpoint overwrites these on load when reachable).
const FUEL_TYPES = ["VLSFO", "LSMGO", "HSFO"];
const DEFAULT_FUEL_PRICES: Record<string, number> = {
  VLSFO: 586.0,
  LSMGO: 737.0,
  HSFO: 435.0,
};
const DEFAULT_ETS_PRICE = 85.0;

// Map a backend vessel "reason" code to an honest Turkish explanation, so the
// user knows WHICH cause they hit (auth vs hourly limit vs request error) rather
// than a vague "trial/limit".
const VESSEL_REASON_TR: Record<string, string> = {
  no_api_key: "API anahtarı tanımlı değil",
  auth: "Trial aktif değil / geçersiz anahtar (yetki)",
  rate_limited: "Saatlik sorgu limiti",
  request_error: "İstek hatası",
  network: "Bağlantı hatası",
  not_in_fleet: "Bu gemi hesabın canlı filo listesinde değil",
  unavailable: "Canlı veri yok",
};
const vesselReasonTr = (reason?: string) =>
  VESSEL_REASON_TR[reason ?? "unavailable"] ?? "Canlı veri yok";

// Thousands-separated integer formatting (Turkish locale).
const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR");

// Duration label (display only — the underlying value stays in hours). For
// voyages over ~48h, show days alongside hours: "X gün Y sa (Z sa)"; under 48h,
// plain hours. Does NOT change any value sent to the API.
function fmtDuration(hours: number): string {
  const h = Math.round(hours);
  if (h < 48) return `${fmt(h)} sa`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  const dayPart = rem > 0 ? `${days} gün ${rem} sa` : `${days} gün`;
  return `${dayPart} (${fmt(h)} sa)`;
}

// Arrow pointing where the wind is blowing TOWARD (Open-Meteo gives the FROM
// direction, so we add 180°). Used as a compact per-leg wind indicator.
const WIND_ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
const windArrow = (fromDeg: number) =>
  WIND_ARROWS[Math.round((((fromDeg + 180) % 360) / 45)) % 8];
// Ocean current direction is already the direction it flows TOWARD, so no offset.
const currentArrow = (towardDeg: number) =>
  WIND_ARROWS[Math.round((towardDeg % 360) / 45) % 8];

// Distinct route colour per alternative candidate (also used for its compare row).
const ALT_COLORS: Record<string, string> = {
  shortest: "#2dd4bf", // teal
  hra_avoiding: "#f59e0b", // amber
  weather_current_optimized: "#a78bfa", // purple
};
const altColor = (id: string) => ALT_COLORS[id] ?? "#2dd4bf";

// IMO tanker CII grade boundaries (attained/required ratio). Used to show how far
// the optimized intensity is from dropping a grade.
const CII_BOUNDS = [0.86, 0.94, 1.06, 1.18]; // A | B | C | D | E
const GRADE_COLORS: Record<string, string> = {
  A: "var(--grade-a)",
  B: "var(--grade-b)",
  C: "var(--grade-c)",
  D: "var(--grade-d)",
  E: "var(--grade-e)",
};
// Percent the attained CII must still drop to reach the next-better grade.
// null when already grade A (nothing better).
function pctToNextGrade(ratio: number): number | null {
  const lower = CII_BOUNDS.filter((b) => b <= ratio).pop();
  if (lower === undefined) return null;
  return ((ratio - lower) / ratio) * 100;
}

// Reference Brent price (USD/bbl) for the top metric bar. NOT live and NOT from
// the API (/prices carries bunker grades + ETS, not Brent) — shown clearly as an
// editable reference value alongside the others.
const DEFAULT_BRENT = 77.6;
// HFO carbon factor — display only (estimated CO₂ = fuel × CF); same value the
// engine uses, no recomputation of any optimized result here.
const CO2_PER_T = 3.114;

// Known chokepoint / risk gates as [latMin, latMax, lonMin, lonMax]. Used purely
// to DERIVE honest warning text from the returned route polyline — no engine call.
const GATES: { box: number[]; label: string }[] = [
  { box: [40.9, 41.4, 28.9, 29.3], label: "İstanbul Boğazı geçişi" },
  { box: [29.8, 31.4, 32.2, 32.7], label: "Süveyş Kanalı geçişi" },
  { box: [0.5, 6.0, 98.0, 104.5], label: "Malacca Boğazı geçişi" },
];
// Gulf of Aden / Arabian Sea piracy area (approx), for the HRA warning/badge.
const HRA_BOX = [8.0, 20.0, 43.0, 68.0];

const inBox = (lat: number, lon: number, box: number[]) =>
  lat >= box[0] && lat <= box[1] && lon >= box[2] && lon <= box[3];

const routeCrossesHra = (coords: number[][]) =>
  coords.some(([lat, lon]) => inBox(lat, lon, HRA_BOX));

const routeChokepoints = (coords: number[][]) =>
  GATES.filter((g) => coords.some(([lat, lon]) => inBox(lat, lon, g.box))).map(
    (g) => g.label
  );

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
    <div className="border-b border-[var(--border)] last:border-b-0 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-[13px] font-semibold text-[var(--text)]"
      >
        <span>{title}</span>
        <span className="text-[var(--muted)]">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

// One labelled cell in the "Sefer Tahmini" metric grid.
function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="text-base font-bold mt-0.5 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

// Full-width reference market strip under the header (Brent / VLSFO / LSMGO /
// EU ETS). Values are editable REFERENCE prices, NOT a live feed — labelled so.
function MetricBar({
  brent,
  vlsfo,
  lsmgo,
  ets,
}: {
  brent: number;
  vlsfo: number;
  lsmgo: number;
  ets: number;
}) {
  const items: [string, number, string][] = [
    ["Brent", brent, "USD/varil"],
    ["VLSFO", vlsfo, "USD/t"],
    ["LSMGO", lsmgo, "USD/t"],
    ["EU ETS", ets, "EUR/tCO₂"],
  ];
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-5 py-1.5 text-sm">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] mr-2 shrink-0">
        Piyasa · referans
      </span>
      {items.map(([label, val, unit]) => (
        <div
          key={label}
          className="flex items-baseline gap-1.5 px-3 border-l border-[var(--border)] first:border-l-0 shrink-0"
        >
          <span className="text-[var(--muted)] text-xs">{label}</span>
          <span className="font-semibold">{val.toLocaleString("tr-TR")}</span>
          <span className="text-[10px] text-[var(--muted)]">{unit}</span>
        </div>
      ))}
      <span className="ml-auto text-[10px] text-[var(--muted)] shrink-0 pl-2">
        canlı değil · düzenlenebilir
      </span>
    </div>
  );
}

export default function Home() {
  // Selected origin/destination ports (full objects, so we have their coords).
  const [originPort, setOriginPort] = useState<Port | null>(null);
  const [destPort, setDestPort] = useState<Port | null>(null);

  // Karadeniz Holding fleet (live VesselFinder AIS). The dropdown list is static;
  // picking a vessel fetches its live data and auto-fills DWT + draft.
  const [vesselList, setVesselList] = useState<VesselListItem[]>([]);
  const [selectedVesselImo, setSelectedVesselImo] = useState<number | "">("");
  const [vesselData, setVesselData] = useState<VesselData | null>(null);
  const [vesselLoading, setVesselLoading] = useState(false);

  // Voyage controls (form state).
  // ETA + its slider bounds are route-aware: set from /route_info so the user can
  // never pick an infeasible ETA and the default lands on a fuel-saving value.
  const [berthEta, setBerthEta] = useState(DEFAULT_ETA);
  const [etaMin, setEtaMin] = useState(50);
  const [etaMax, setEtaMax] = useState(800);
  const [minTimeH, setMinTimeH] = useState<number | null>(null);
  // Distance-based leg count (from /route_info); sizes the weather sliders.
  const [numLegs, setNumLegs] = useState(NUM_LEGS);
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

  // Alternative routes (POST /alternatives) + which one is currently shown. null
  // selection = show the primary /optimize result (the shortest lane).
  const [alternatives, setAlternatives] = useState<AltRoute[] | null>(null);
  const [altLoading, setAltLoading] = useState(false);
  const [selectedAltId, setSelectedAltId] = useState<string | null>(null);

  // Click-to-pick mode: clicking the map snaps the chosen endpoint to the
  // nearest named port. "off" disables map clicks (default).
  const [pickMode, setPickMode] = useState<"off" | "origin" | "dest">("off");

  // Fire one automatic optimize on first load (once both default ports +
  // route_info have resolved) so the map and results are never empty. This ref
  // guards it so it never re-runs when the user later changes ports.
  const didAutoRun = useRef(false);
  // Signature of the inputs that were last sent to /optimize. The debounced
  // re-optimize effect compares the current signature against this so it only
  // re-runs when something actually changed (and never loops on its own output).
  const lastOptSig = useRef<string | null>(null);

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

  // Load the static Karadeniz Holding fleet list once (no API call server-side).
  useEffect(() => {
    fetch(`${API}/vessels`)
      .then((r) => r.json())
      .then((list: VesselListItem[]) => setVesselList(list))
      .catch(() => setVesselList([]));
  }, []);

  // Pick a fleet vessel -> fetch its live AIS data (cached + rate-limited on the
  // backend). On success auto-fill DWT + draft (still editable); on failure keep
  // manual inputs and show an honest "no live data" note.
  async function handleSelectVessel(imo: number | "") {
    setSelectedVesselImo(imo);
    if (imo === "") {
      setVesselData(null);
      return;
    }
    setVesselLoading(true);
    try {
      const res = await fetch(`${API}/vessels/${imo}`);
      const data: VesselData = await res.json();
      setVesselData(data);
      if (data.available) {
        // Auto-fill the vessel's real specs (the debounce re-optimizes with them).
        if (typeof data.dwt === "number" && data.dwt > 0) setDwt(Math.round(data.dwt));
        if (typeof data.draught_m === "number" && data.draught_m > 0)
          setDraftDm(data.draught_m);
      }
    } catch {
      setVesselData({ imo: Number(imo), name: String(imo), available: false, reason: "error" });
    } finally {
      setVesselLoading(false);
    }
  }

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
    )}&dest=${encodeURIComponent(destRef)}`;
    fetch(url)
      .then((r) => r.json())
      .then(
        (info: {
          min_time_h: number;
          baseline_time_h: number;
          suggested_eta_h: number;
          num_legs: number;
        }) => {
          setMinTimeH(info.min_time_h);
          // Floor at the earliest feasible arrival so an infeasible ETA can't be
          // chosen; cap generously at twice the baseline time.
          setEtaMin(Math.ceil(info.min_time_h));
          setEtaMax(Math.round(info.baseline_time_h * 2));
          setBerthEta(info.suggested_eta_h);
          // Resize the manual weather sliders to the route's leg count (so they
          // line up with how the backend will segment this route).
          setNumLegs(info.num_legs);
          setWeather((prev) =>
            Array.from({ length: info.num_legs }, (_, i) => prev[i] ?? 1.0)
          );
          // First load only: auto-optimize with the just-computed ETA so the
          // map draws a route and the right panel shows results immediately.
          // Subsequent input changes re-optimize via the debounced effect below;
          // this guard keeps the first run from firing more than once.
          if (!didAutoRun.current) {
            didAutoRun.current = true;
            handleOptimize(info.suggested_eta_h);
          }
        }
      )
      .catch(() => {
        /* keep current ETA bounds on failure */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Shared request body for /optimize and /alternatives. num_legs is omitted on
  // purpose so the backend picks a distance-based count (matching /route_info).
  function buildPayload(eta: number) {
    return {
      origin: originRef,
      dest: destRef,
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
  }

  // Signature of every input that changes the /optimize result, used by the
  // debounced auto re-optimize below. Weather is only included when MANUAL: with
  // auto-weather ON the server replaces it from live data, and the read-only
  // sliders (and the slider resize on route change) shouldn't trigger a re-run.
  function optSigFor(eta: number) {
    return JSON.stringify({
      eta,
      originRef,
      destRef,
      dwt,
      serviceSpeed,
      year,
      draftDm,
      daysSinceDrydock,
      load,
      autoWeather,
      fuelType,
      fuelPrices,
      etsPrice,
      euScopeFraction,
      weather: autoWeather ? null : weather,
    });
  }

  // Fetch + score the candidate routes (runs after the main result is shown).
  async function fetchAlternatives(eta: number) {
    setAltLoading(true);
    try {
      const res = await fetch(`${API}/alternatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(eta)),
      });
      if (!res.ok) throw new Error();
      setAlternatives((await res.json()) as AltRoute[]);
    } catch {
      setAlternatives(null);
    } finally {
      setAltLoading(false);
    }
  }

  // The backend schema requires dwt > 0, draft_dm > 0 and load in [0,1]. A
  // free-text number input the user momentarily clears becomes Number("") === 0,
  // and the F6 debounced re-optimize would POST that mid-edit value and get a
  // 422 back. Gate every /optimize call on the payload being schema-valid so we
  // never send an out-of-range request (and disable the button until it is).
  const inputsValid =
    Number.isFinite(dwt) && dwt > 0 &&
    Number.isFinite(draftDm) && draftDm > 0 &&
    Number.isFinite(serviceSpeed) && serviceSpeed > 0 &&
    Number.isFinite(daysSinceDrydock) && daysSinceDrydock >= 0 &&
    Number.isFinite(berthEta) && berthEta > 0 &&
    load >= 0 && load <= 1;

  async function handleOptimize(etaOverride?: number) {
    if (!originRef || !destRef) {
      setError("Lütfen kalkış ve varış limanı seçin");
      return;
    }
    if (!inputsValid) {
      setError("Geçersiz girdi: DWT, draft ve servis hızı 0'dan büyük olmalı.");
      return;
    }
    const eta = etaOverride ?? berthEta;
    if (etaOverride !== undefined) setBerthEta(etaOverride);
    // Record what we're optimizing for so the debounced effect won't re-fire on
    // this same input set (and never loops on its own state updates).
    lastOptSig.current = optSigFor(eta);
    setLoading(true);
    setError(null);
    // A fresh optimize invalidates the previous candidate comparison/selection.
    setAlternatives(null);
    setSelectedAltId(null);
    try {
      const res = await fetch(`${API}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(eta)),
      });
      if (!res.ok) {
        throw new Error(`Sunucu hatası: ${res.status}`);
      }
      const data: OptimizeResponse = await res.json();
      setResult(data);
      // Then populate the comparison panel (cheap: reuses the weather cache).
      if (data.feasible) fetchAlternatives(eta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen bir hata oluştu");
    } finally {
      setLoading(false);
    }
  }

  // Debounced auto re-optimize: after the first load, any change to a voyage
  // input (ETA, speed, DWT, draft, drydock, load, weather mode, fuel/year, or
  // ports) re-runs /optimize with the CURRENT form state. The signature compare
  // means it fires only on a real change and never loops on its own output.
  const optSig = optSigFor(berthEta);
  useEffect(() => {
    if (!didAutoRun.current) return; // first run is handled on route load
    if (!originRef || !destRef) return;
    if (!inputsValid) return; // never POST a schema-invalid payload mid-edit
    if (optSig === lastOptSig.current) return; // nothing actually changed
    const t = setTimeout(() => handleOptimize(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optSig]);

  // Turn a selected candidate into the OptimizeResponse shape the result cards
  // expect, so clicking a candidate loads its metrics into the existing cards.
  function altToResult(c: AltRoute): OptimizeResponse {
    const scen = (
      fuel: number,
      att: number,
      ratio: number,
      grade: string,
      cost: number,
      speeds: number[] | null
    ): ScenarioOut => ({
      fuel_t: fuel,
      total_time_h: c.total_time_h,
      attained_cii: att,
      cii_ratio: ratio,
      cii_grade: grade,
      speeds,
      fuel_cost_usd: cost,
      ets_cost_eur: 0,
      eca_nm: c.eca_nm,
      non_eca_nm: 0,
      blended_fuel_cost_usd: cost,
    });
    return {
      baseline: scen(
        c.baseline_fuel_t,
        c.baseline_cii_attained,
        c.baseline_cii_ratio,
        c.baseline_cii_grade,
        c.baseline_cost_usd,
        null
      ),
      optimized: scen(
        c.fuel_t,
        c.cii_attained,
        c.cii_ratio,
        c.cii_grade,
        c.cost_usd,
        c.speeds
      ),
      saving_pct: c.saving_pct,
      co2_saved_t: c.co2_saved_t,
      money_saved_usd: c.money_saved_usd,
      distance_nm: c.distance_nm,
      // Candidates don't carry a per-leg fuel breakdown; the map still draws leg
      // boundaries from legs_weather chunks, just without per-leg fuel tooltips.
      num_legs: c.legs_weather?.length ?? 0,
      per_leg: null,
      route_coords: c.route_coords,
      eca_zones: result?.eca_zones ?? null,
      feasible: c.feasible,
      min_time_h: c.min_time_h,
      legs_weather: c.legs_weather,
    };
  }

  // The selected candidate (if any) overrides the primary result for display.
  const selectedAlt =
    selectedAltId && alternatives
      ? alternatives.find((c) => c.id === selectedAltId) ?? null
      : null;
  const displayResult = selectedAlt ? altToResult(selectedAlt) : result;

  const routeCoords = (displayResult?.route_coords ?? []) as [number, number][];

  // Pick the meaningful fuel cost: blended when the route touches an ECA.
  const scenarioCost = (s: ScenarioOut) =>
    s.eca_nm > 0 ? s.blended_fuel_cost_usd : s.fuel_cost_usd;

  // Honest "Kritik Uyarı" list + zone facts, derived from the returned route
  // polyline and ECA distance only (no engine call). HRA + chokepoint gates are
  // simple lon/lat boxes; ECA distance is the existing baseline.eca_nm field.
  const dispCoords = displayResult?.route_coords ?? [];
  const warnHra = dispCoords.length > 0 && routeCrossesHra(dispCoords);
  const chokepoints = dispCoords.length > 0 ? routeChokepoints(dispCoords) : [];
  const dispEcaNm = displayResult?.baseline.eca_nm ?? 0;
  const warnings: { label: string; tone: "e" | "c" | "muted" }[] = [];
  if (warnHra)
    warnings.push({ label: "Korsanlık riski (HRA) — Aden Körfezi", tone: "e" });
  if (dispEcaNm > 0)
    warnings.push({ label: "ECA — düşük kükürtlü yakıt zorunlu", tone: "c" });
  chokepoints.forEach((c) => warnings.push({ label: c, tone: "muted" }));
  const warnTone = (t: "e" | "c" | "muted") =>
    t === "e" ? "var(--grade-e)" : t === "c" ? "var(--grade-c)" : "var(--muted)";

  // CO2 emission reduction — DISPLAY ONLY, from existing fuel_t fields and the
  // same carbon factor the engine uses. No engine call, no new endpoint.
  const co2Baseline = (displayResult?.baseline.fuel_t ?? 0) * CO2_PER_T;
  const co2Optimized = (displayResult?.optimized.fuel_t ?? 0) * CO2_PER_T;
  const co2Saved = co2Baseline - co2Optimized;
  const co2ReductionPct = co2Baseline > 0 ? (co2Saved / co2Baseline) * 100 : 0;
  const CO2_TARGET_PCT = 5; // brief's ~5% reduction goal (reference only)

  // Representative PRUVA-suggested speed: the distance-weighted mean of the
  // optimized per-leg speeds (falls back to the plain mean of the speed list).
  // Compared against the vessel's REAL current AIS speed below.
  const suggestedSpeedKn = (() => {
    const pl = displayResult?.per_leg;
    if (pl && pl.length > 0) {
      const dist = pl.reduce((s, p) => s + p.distance_nm, 0);
      if (dist > 0) return pl.reduce((s, p) => s + p.speed_kn * p.distance_nm, 0) / dist;
    }
    const sp = displayResult?.optimized.speeds;
    if (sp && sp.length > 0) return sp.reduce((s, v) => s + v, 0) / sp.length;
    return null;
  })();
  const vesselSpeed =
    vesselData?.available && typeof vesselData.speed_kn === "number"
      ? vesselData.speed_kn
      : null;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Top bar: PRUVA wordmark + tagline + honest DEMO pill. */}
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-2 bg-[var(--panel)]">
        <span className="text-lg font-extrabold tracking-wide text-[var(--accent)]">
          PRUVA
        </span>
        <span className="hidden sm:inline text-sm text-[var(--muted)]">
          Akıllı Tanker Rota &amp; Yakıt Optimizasyon Platformu
        </span>
        <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border border-[var(--accent)] text-[var(--accent)]">
          DEMO
        </span>
      </header>

      {/* Reference market strip (editable, NOT live). */}
      <MetricBar
        brent={DEFAULT_BRENT}
        vlsfo={fuelPrices.VLSFO ?? 0}
        lsmgo={fuelPrices.LSMGO ?? 0}
        ets={etsPrice}
      />

      {/* Responsive 3-column layout: inputs | map | results. */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_400px] gap-2 p-2">
        {/* LEFT: inputs — scrolls internally so the page stays one screen tall. */}
        <div className="pruva-card p-3 self-start lg:h-[calc(100vh-5.5rem)] lg:overflow-y-auto">
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

          <Section title="Gemi (Karadeniz Holding)">
            <div>
              <label className="pruva-label">Gemi seç (canlı AIS)</label>
              <select
                value={selectedVesselImo}
                onChange={(e) =>
                  handleSelectVessel(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="pruva-input"
              >
                <option value="">Manuel (gemi seçme)</option>
                {vesselList.map((v) => (
                  <option key={v.imo} value={v.imo}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            {vesselLoading && (
              <p className="text-xs text-[var(--muted)]">Gemi verisi alınıyor…</p>
            )}
            {vesselData && vesselData.available && (
              <p className="text-xs text-[var(--accent)]">
                ● Canlı veri: {vesselData.name}
                {typeof vesselData.speed_kn === "number" &&
                  ` · ${vesselData.speed_kn.toFixed(1)} kn`}
                {vesselData.destination ? ` → ${vesselData.destination}` : ""}
                <span className="block text-[var(--muted)]">
                  DWT ve draft gerçek veriden dolduruldu (düzenlenebilir).
                </span>
              </p>
            )}
            {vesselData && !vesselData.available && (
              <p className="text-xs text-[var(--muted)]">
                ○ Canlı gemi verisi alınamadı: {vesselReasonTr(vesselData.reason)}.
                Manuel girişler geçerli.
              </p>
            )}
          </Section>

          <Section title="Sefer">
            {/* ETA = the optimizer CONSTRAINT (arrive-by deadline). Boxed with an
                accent border + helper so it doesn't read as linked to service
                speed (which is only the independent baseline reference). */}
            <div className="rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] bg-[var(--bg)] p-2.5">
              <label className="pruva-label">
                Liman Varış Süresi — ETA (kısıt): {fmtDuration(berthEta)}
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
                  En erken varış: {fmtDuration(minTimeH)}
                </p>
              )}
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Optimize hedefi: gemi bu süreye kadar varmalı (kısıt).
              </p>
            </div>

            {/* Service speed is the baseline/reference only — NOT linked to ETA. */}
            <div>
              <label className="pruva-label">Servis Hızı (kn) — baz</label>
              <input
                type="number"
                step={0.1}
                value={serviceSpeed}
                onChange={(e) => setServiceSpeed(Number(e.target.value))}
                className="pruva-input"
              />
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Karşılaştırma için baz hız — optimize ondan bağımsız hesaplanır.
              </p>
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
            {/* Idle/anchor days = the single fouling driver (days_since_drydock),
                placed right under Yıl. */}
            <div>
              <label className="pruva-label">Demirde Bekleme / Drydock&apos;tan Gün</label>
              <input
                type="number"
                min={0}
                value={daysSinceDrydock}
                onChange={(e) => setDaysSinceDrydock(Number(e.target.value))}
                className="pruva-input"
              />
            </div>
            {daysSinceDrydock > HULL_CLEAN_THRESHOLD && (
              <p
                className="text-[11px] -mt-1"
                style={{ color: "var(--grade-d)" }}
              >
                ⚠ Tekne kirliliği yüksek — gövde temizliği önerilir (yakıt
                verimliliği düşüyor).
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
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
              Bacak Bazında Hava · {numLegs} bacak (1.0 sakin → 1.6 fırtına)
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

            {/* Per-leg live detail — collapsible + scrollable so it never floods
                the panel with 6×2 always-visible lines. */}
            {autoWeather && result?.legs_weather && (
              <Section title="Bacak detayları (canlı hava/akıntı)" defaultOpen={false}>
              <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">
                {result.legs_weather.map((lw, i) => (
                  <div key={i} className="text-xs">
                    <div className="flex items-center justify-between">
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
                    {(lw.current_kn != null || lw.sog_kn != null) && (
                      <div className="text-[var(--muted)]">
                        {lw.current_kn != null && (
                          <>
                            Akıntı {lw.current_kn} kn
                            {lw.current_dir != null && ` ${currentArrow(lw.current_dir)}`}
                          </>
                        )}
                        {lw.sog_kn != null && <> {" · "}SOG {lw.sog_kn} kn</>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              </Section>
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
            disabled={loading || !inputsValid}
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
        <div className="lg:h-[calc(100vh-5.5rem)] min-h-[480px] flex flex-col gap-2">
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
              legsWeather={displayResult?.legs_weather ?? null}
              perLeg={displayResult?.per_leg ?? null}
              pickMode={pickMode}
              onMapPick={handleMapPick}
              routeColor={selectedAlt ? altColor(selectedAlt.id) : undefined}
            />
          </div>
        </div>

        {/* RIGHT: results — scrolls internally so the page stays one screen tall. */}
        <div className="space-y-2.5 self-start lg:h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:pr-1">
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
                erken varış: {fmtDuration(result.min_time_h)}.
              </p>
              <button
                onClick={() => handleOptimize(Math.ceil(result.min_time_h))}
                className="rounded-lg bg-[var(--accent)] text-[#04201c] font-semibold px-3 py-1.5 text-sm hover:opacity-90"
              >
                ETA&apos;yı uygulanabilir yap
              </button>
            </div>
          )}

          {result && result.feasible && displayResult && (
            <>
              {/* When a candidate is selected, say so + offer a way back. */}
              {selectedAlt && (
                <div className="pruva-card p-3 text-xs flex items-center justify-between">
                  <span>
                    Görüntülenen rota:{" "}
                    <span
                      className="font-semibold"
                      style={{ color: altColor(selectedAlt.id) }}
                    >
                      {selectedAlt.label}
                    </span>
                  </span>
                  <button
                    onClick={() => setSelectedAltId(null)}
                    className="text-[var(--accent)] font-medium hover:underline"
                  >
                    En kısaya dön
                  </button>
                </div>
              )}

              {/* Headline: money saved. Never render a negative value as a big
                  teal hero — if there's no slack to slow down, show it muted. */}
              <div className="pruva-card p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  Para Tasarrufu
                </p>
                {displayResult.money_saved_usd > 0 ? (
                  <>
                    <p className="text-3xl font-extrabold text-[var(--accent)] mt-0.5">
                      ${fmt(displayResult.money_saved_usd)}
                    </p>
                    <p className="text-sm text-[var(--muted)] mt-0.5">
                      Yakıt tasarrufu %{displayResult.saving_pct.toFixed(1)} · CO₂{" "}
                      {fmt(displayResult.co2_saved_t)} t
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xl font-semibold text-[var(--muted)] mt-0.5">
                      ${fmt(displayResult.money_saved_usd)}
                    </p>
                    <p className="text-sm text-[var(--muted)] mt-0.5">
                      Bu ETA&apos;da yavaşlama payı yok — ETA&apos;yı artırın.
                    </p>
                  </>
                )}
              </div>

              {/* CO₂ emission reduction — primary metric (peer of money saved).
                  The project goal is fuel saving AND emission reduction. */}
              <div className="pruva-card p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  CO₂ Emisyon Azaltımı
                </p>
                {co2Saved > 0 ? (
                  <>
                    <p className="text-3xl font-extrabold text-[var(--grade-a)] mt-0.5">
                      %{co2ReductionPct.toFixed(1)} azaltım
                    </p>
                    <p className="text-sm text-[var(--muted)] mt-0.5">
                      {fmt(co2Baseline)} t → {fmt(co2Optimized)} t CO₂ (−
                      {fmt(co2Saved)} t)
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      Hedef: ≥%{CO2_TARGET_PCT} — Ulaşılan: %
                      {co2ReductionPct.toFixed(1)}{" "}
                      {co2ReductionPct >= CO2_TARGET_PCT ? "✓" : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xl font-semibold text-[var(--muted)] mt-0.5">
                      %{co2ReductionPct.toFixed(1)} azaltım
                    </p>
                    <p className="text-sm text-[var(--muted)] mt-0.5">
                      Bu ETA&apos;da emisyon azaltımı yok — ETA&apos;yı artırın.
                    </p>
                  </>
                )}
              </div>

              {/* Live vessel vs PRUVA suggestion — real AIS speed against the
                  optimized speed. Only when a fleet vessel with live data is
                  selected; otherwise the rest of the panel works unchanged. */}
              {vesselSpeed !== null && suggestedSpeedKn !== null && (
                <div className="pruva-card p-4">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    Gemi vs PRUVA · {vesselData?.name}
                  </p>
                  {(() => {
                    // AIS nav status 1 = at anchor, 5 = moored. A moored/idle
                    // ship at 0 kn must NOT be shown as a misleading "0 vs X".
                    const navMoored =
                      vesselData?.nav_status === 1 || vesselData?.nav_status === 5;
                    const moored = vesselSpeed === 0 || navMoored;
                    if (moored) {
                      return (
                        <p className="text-sm mt-2">
                          Gemi şu an demirde (0 kn). Seyir halinde olsaydı PRUVA
                          önerisi:{" "}
                          <span className="font-bold text-[var(--accent)]">
                            {suggestedSpeedKn.toFixed(1)} kn
                          </span>
                          .
                        </p>
                      );
                    }
                    const diff = vesselSpeed - suggestedSpeedKn;
                    return (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-2.5">
                            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                              Geminin anlık hızı
                            </p>
                            <p className="text-lg font-bold mt-0.5">
                              {vesselSpeed.toFixed(1)} kn
                            </p>
                          </div>
                          <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-2.5">
                            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                              PRUVA önerisi (ort.)
                            </p>
                            <p className="text-lg font-bold mt-0.5 text-[var(--accent)]">
                              {suggestedSpeedKn.toFixed(1)} kn
                            </p>
                          </div>
                        </div>
                        {diff > 0.1 ? (
                          <p className="text-sm text-[var(--muted)] mt-2">
                            Gemi öneriden {diff.toFixed(1)} kn daha hızlı —
                            yavaşlama ile yakıt tasarrufu potansiyeli.
                          </p>
                        ) : diff < -0.1 ? (
                          <p className="text-sm text-[var(--muted)] mt-2">
                            Gemi öneriden {Math.abs(diff).toFixed(1)} kn daha yavaş
                            seyrediyor — varış süresine dikkat.
                          </p>
                        ) : (
                          <p className="text-sm text-[var(--muted)] mt-2">
                            Gemi zaten öneriye yakın hızda seyrediyor.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* SEFER TAHMİNİ — route header, warnings, zone chips, metric grid. */}
              <div className="pruva-card p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold tracking-wide">SEFER TAHMİNİ</h2>
                    <span className="text-[10px] text-[var(--muted)]">
                      Gerçek Deniz Rotası
                    </span>
                  </div>
                  <p className="text-sm text-[var(--muted)] mt-0.5">
                    {originPort ? titleCase(originPort.name) : "Kalkış"} →{" "}
                    {destPort ? titleCase(destPort.name) : "Varış"} ·{" "}
                    {fmtDuration(displayResult.optimized.total_time_h)}
                  </p>
                </div>

                {/* Kritik Uyarı list (real, derived from the route). */}
                {warnings.length > 0 && (
                  <div className="rounded-lg border border-[var(--grade-d)] bg-[rgba(249,115,22,0.08)] p-2.5">
                    <p className="text-xs font-semibold text-[var(--grade-d)] mb-1">
                      ⚠ KRİTİK UYARI: {warnings.length} uyarı
                    </p>
                    <ul className="space-y-0.5">
                      {warnings.map((w, i) => (
                        <li
                          key={i}
                          className="text-xs flex items-center gap-1.5"
                          style={{ color: warnTone(w.tone) }}
                        >
                          <span>•</span>
                          {w.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Zone chips. */}
                <div className="flex gap-2 flex-wrap">
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full border"
                    style={{
                      borderColor:
                        dispEcaNm > 0 ? "var(--grade-c)" : "var(--border)",
                      color: dispEcaNm > 0 ? "var(--grade-c)" : "var(--muted)",
                    }}
                  >
                    ECA: {dispEcaNm > 0 ? `${fmt(dispEcaNm)} nm` : "yok"}
                  </span>
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full border"
                    style={{
                      borderColor: warnHra ? "var(--grade-e)" : "var(--grade-a)",
                      color: warnHra ? "var(--grade-e)" : "var(--grade-a)",
                    }}
                  >
                    HRA: {warnHra ? "var" : "yok"}
                  </span>
                </div>

                {/* Metric grid (2-col, like the presented dashboard). */}
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Mesafe" value={`${fmt(displayResult.distance_nm)} nm`} />
                  <Metric
                    label="Sefer Süresi"
                    value={fmtDuration(displayResult.optimized.total_time_h)}
                    sub={`ETA hedefi ${fmtDuration(berthEta)}`}
                  />
                  <Metric
                    label="Tahmini Yakıt"
                    value={`${fmt(displayResult.optimized.fuel_t)} t`}
                    sub={`baz ${fmt(displayResult.baseline.fuel_t)} t`}
                  />
                  <Metric
                    label="Tahmini CO₂"
                    value={`${fmt(displayResult.optimized.fuel_t * CO2_PER_T)} t`}
                    sub={`baz ${fmt(displayResult.baseline.fuel_t * CO2_PER_T)} t`}
                  />
                  <Metric
                    label="Yakıt Maliyeti"
                    value={`$${fmt(scenarioCost(displayResult.optimized))}`}
                    sub={`baz $${fmt(scenarioCost(displayResult.baseline))}`}
                  />
                  <Metric
                    label="EU ETS Maliyeti"
                    value={`€${fmt(displayResult.optimized.ets_cost_eur)}`}
                    sub={
                      euScopeFraction > 0
                        ? `kapsam %${Math.round(euScopeFraction * 100)}`
                        : "kapsam dışı"
                    }
                  />
                </div>
              </div>

              {/* Regulatory layer — the legal meaning of the reduction above
                  (IMO CII grade), not the headline metric. Improvement is visible
                  even when the A-E grade holds (e.g. E -> E). */}
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] pt-1">
                Regülasyon · IMO CII
              </p>
              <CiiBadge
                baselineGrade={displayResult.baseline.cii_grade}
                optimizedGrade={displayResult.optimized.cii_grade}
              />
              <div className="pruva-card p-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted)]">Atılan CII (g/dwt·nm)</span>
                  <span>
                    {displayResult.baseline.attained_cii.toFixed(1)} →{" "}
                    {displayResult.optimized.attained_cii.toFixed(1)}
                  </span>
                </div>
                {(() => {
                  const pct = pctToNextGrade(displayResult.optimized.cii_ratio);
                  return pct != null ? (
                    <p className="text-[11px] text-[var(--muted)]">
                      Bir alt CII kademesine %{pct.toFixed(0)} kaldı
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--grade-a)]">
                      En iyi CII kademesinde (A)
                    </p>
                  );
                })()}
              </div>

              <SpeedProfileChart
                legs={legsForChart}
                speeds={displayResult.optimized.speeds}
              />
              <FuelCompareChart
                baselineFuel={displayResult.baseline.fuel_t}
                optimizedFuel={displayResult.optimized.fuel_t}
                savingPct={displayResult.saving_pct}
              />

              {/* Per-leg FUEL breakdown (from /optimize per_leg) — each leg's
                  optimized fuel alongside its conditions. Collapsible to keep the
                  panel compact; scrolls when a long voyage has many legs. */}
              {displayResult.per_leg && displayResult.per_leg.length > 0 && (
                <div className="pruva-card p-3">
                  <Section title={`Bacak Bazında Yakıt (${displayResult.per_leg.length} bacak)`} defaultOpen={false}>
                    <div className="max-h-56 overflow-y-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-[var(--muted)] text-right">
                            <th className="text-left font-medium py-1">Bacak</th>
                            <th className="font-medium">nm</th>
                            <th className="font-medium">kn</th>
                            <th className="font-medium">Yakıt t</th>
                            <th className="font-medium">Dalga</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayResult.per_leg.map((p) => {
                            const storm = p.weather_factor > 1.2;
                            return (
                              <tr
                                key={p.leg_index}
                                className="text-right border-t border-[var(--border)]"
                              >
                                <td className="text-left py-1 flex items-center gap-1.5">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full"
                                    style={{
                                      backgroundColor: storm
                                        ? "var(--grade-e)"
                                        : "var(--accent)",
                                    }}
                                  />
                                  {p.leg_index + 1}
                                </td>
                                <td>{fmt(p.distance_nm)}</td>
                                <td>{p.speed_kn.toFixed(1)}</td>
                                <td className="font-semibold text-[var(--accent)]">
                                  {p.fuel_t.toFixed(1)}
                                </td>
                                <td className={storm ? "text-[var(--grade-e)]" : ""}>
                                  {p.wave_m.toFixed(1)} m
                                  {p.beaufort > 0 && ` · Bft ${p.beaufort.toFixed(0)}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-[10px] text-[var(--muted)] mt-1.5">
                        Kırmızı nokta = fırtınalı bacak. Yakıt değerleri optimize
                        edilmiş hız profilinden; toplam {fmt(displayResult.optimized.fuel_t)} t.
                      </p>
                    </div>
                  </Section>
                </div>
              )}

              {/* Rota Alternatifleri — compare candidates and pick one. */}
              {(altLoading || (alternatives && alternatives.length > 1)) && (
                <div className="pruva-card p-4 text-sm">
                  <h2 className="font-semibold mb-2">Rota Alternatifleri</h2>
                  {altLoading && !alternatives && (
                    <p className="text-xs text-[var(--muted)]">
                      Alternatifler hesaplanıyor…
                    </p>
                  )}
                  <div className="space-y-2">
                    {alternatives?.map((c) => {
                      const active =
                        selectedAltId === c.id ||
                        (selectedAltId === null && c.id === "shortest");
                      return (
                        <button
                          key={c.id}
                          onClick={() =>
                            setSelectedAltId(c.id === "shortest" ? null : c.id)
                          }
                          className="w-full text-left rounded-lg border p-2.5 transition-colors"
                          style={{
                            borderColor: active
                              ? altColor(c.id)
                              : "var(--border)",
                            backgroundColor: active
                              ? "rgba(45,212,191,0.06)"
                              : "transparent",
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium flex items-center gap-1.5">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: altColor(c.id) }}
                              />
                              {c.label}
                            </span>
                            {c.recommended && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-[#04201c]">
                                Önerilen
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
                            <span>Mesafe: {fmt(c.distance_nm)} nm</span>
                            <span>Süre: {fmt(c.total_time_h)} sa</span>
                            <span>Yakıt: {fmt(c.fuel_t)} t</span>
                            <span>
                              Maliyet: ${fmt(c.cost_usd)}
                            </span>
                            <span className="flex items-center gap-1">
                              CII:{" "}
                              <span
                                className="font-semibold px-1 rounded"
                                style={{ color: GRADE_COLORS[c.cii_grade] }}
                              >
                                {c.cii_grade}
                              </span>
                            </span>
                            <span>
                              Kısaya göre:{" "}
                              {c.money_vs_shortest === 0
                                ? "—"
                                : `${c.money_vs_shortest > 0 ? "+" : ""}$${fmt(
                                    c.money_vs_shortest
                                  )}`}
                            </span>
                          </div>
                          <div className="mt-1 flex gap-1.5 flex-wrap">
                            {c.crosses_hra ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--grade-e)] text-[var(--grade-e)]">
                                HRA riski
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--grade-a)] text-[var(--grade-a)]">
                                HRA yok
                              </span>
                            )}
                            {c.eca_nm > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--muted)]">
                                ECA {fmt(c.eca_nm)} nm
                              </span>
                            )}
                            {!c.feasible && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--grade-e)] text-[var(--grade-e)]">
                                ETA yetişmez
                              </span>
                            )}
                            {c.approx && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border)] text-[var(--muted)]">
                                yaklaşık
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
