"use client";

import { useEffect, useRef, useState } from "react";

export type Port = {
  id?: number | string;
  name: string;
  country: string;
  lat: number;
  lon: number;
};

const API = process.env.NEXT_PUBLIC_API_URL;

// WPI port names are UPPERCASE; show them title-cased for readability.
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

type Props = {
  label: string;
  value: Port | null;
  onSelect: (p: Port) => void;
};

/**
 * Searchable port combobox: the user types, a debounced /ports/search call
 * fills a dropdown, and selecting a row reports the chosen port to the parent.
 */
export default function PortCombobox({ label, value, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Port[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // While the dropdown is open the box shows what the user is typing; otherwise
  // it shows the current selection.
  const display = open
    ? query
    : value
    ? `${titleCase(value.name)} — ${value.country}`
    : "";

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    // Debounce ~300ms so we don't fire a request on every keystroke.
    timer.current = setTimeout(() => {
      setLoading(true);
      fetch(`${API}/ports/search?q=${encodeURIComponent(q)}&limit=20`)
        .then((r) => r.json())
        .then((rows: Port[]) => setResults(rows))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, open]);

  function pick(p: Port) {
    onSelect(p);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative">
      <label className="pruva-label">{label}</label>
      <input
        className="pruva-input"
        value={display}
        placeholder="Liman ara..."
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setOpen(true);
          setQuery(e.target.value);
        }}
        // Delay close so a click on a result (onMouseDown) registers first.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim().length >= 2 && (
        <ul className="absolute z-[1000] mt-1 w-full max-h-60 overflow-auto pruva-card text-sm">
          {loading && (
            <li className="px-2 py-1 text-[var(--muted)]">Aranıyor...</li>
          )}
          {!loading && results.length === 0 && (
            <li className="px-2 py-1 text-[var(--muted)]">Sonuç yok</li>
          )}
          {results.map((p) => (
            <li
              key={`${p.id}-${p.lat}-${p.lon}`}
              className="px-2 py-1 cursor-pointer hover:bg-[var(--bg)]"
              onMouseDown={() => pick(p)}
            >
              {titleCase(p.name)}{" "}
              <span className="text-[var(--muted)]">— {p.country}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
