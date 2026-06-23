"use client";

import { useEffect, useState } from "react";
import {
  LayerGroup,
  LayersControl,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API = process.env.NEXT_PUBLIC_API_URL;

type LatLon = [number, number];
type LegWeather = { factor: number; wave_m: number | null; source: string };

// GeoJSON feature as served by GET /zones (coordinates are [lon, lat]).
type ZoneFeature = {
  properties: { name: string; type: "ECA" | "HRA"; color: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
};

type PickMode = "off" | "origin" | "dest";

type Props = {
  routeCoords: LatLon[];
  originName?: string;
  destName?: string;
  legsWeather?: LegWeather[] | null;
  pickMode?: PickMode;
  onMapPick?: (lat: number, lon: number) => void;
};

const ROUTE_TEAL = "#2dd4bf";
const ROUTE_STORM = "#ef4444";
const CASING = "#ffffff";
const STORM_FACTOR = 1.2; // legs above this are drawn red

// Custom markers: teal dot for the start, checkered flag for the destination.
const ORIGIN_ICON = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:${ROUTE_TEAL};border:2px solid #fff;box-shadow:0 0 5px rgba(0,0,0,.6)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});
const DEST_ICON = L.divIcon({
  className: "",
  html: `<div style="font-size:20px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))">🏁</div>`,
  iconSize: [20, 20],
  iconAnchor: [3, 18],
});

// Split the full polyline into k contiguous chunks matching the backend's leg
// resampling, so each leg segment can be colored by its weather.
function legChunks(coords: LatLon[], k: number): LatLon[][] {
  const nSeg = coords.length - 1;
  const chunks: LatLon[][] = [];
  for (let i = 0; i < k; i++) {
    const start = Math.floor((i * nSeg) / k);
    const end = Math.floor(((i + 1) * nSeg) / k);
    chunks.push(coords.slice(start, end + 1));
  }
  return chunks;
}

// When pick mode is active, forward map clicks (lat, lon) to the parent, which
// snaps them to the nearest port. A crosshair cursor signals the mode is live.
function MapClickPicker({
  pickMode,
  onMapPick,
}: {
  pickMode: PickMode;
  onMapPick: (lat: number, lon: number) => void;
}) {
  const map = useMapEvents({
    click(e) {
      if (pickMode !== "off") onMapPick(e.latlng.lat, e.latlng.lng);
    },
  });
  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = pickMode === "off" ? "" : "crosshair";
    return () => {
      el.style.cursor = "";
    };
  }, [pickMode, map]);
  return null;
}

// Fit the map to the route whenever the coordinates change.
function FitBounds({ coords }: { coords: LatLon[] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) {
      map.fitBounds(coords as L.LatLngBoundsExpression, { padding: [30, 30] });
    }
  }, [coords, map]);
  return null;
}

/**
 * Hero map: CARTO dark basemap + OpenSeaMap seamark overlay, ECA/HRA zone
 * polygons, and the weather-colored route with a white casing. Layers are
 * toggleable via the top-right control.
 */
export default function RouteMap({
  routeCoords,
  originName,
  destName,
  legsWeather,
  pickMode = "off",
  onMapPick,
}: Props) {
  const [zones, setZones] = useState<ZoneFeature[]>([]);

  useEffect(() => {
    fetch(`${API}/zones`)
      .then((r) => r.json())
      .then((fc: { features: ZoneFeature[] }) => setZones(fc.features))
      .catch(() => setZones([]));
  }, []);

  const hasRoute = routeCoords.length > 0;
  const origin = hasRoute ? routeCoords[0] : null;
  const dest = hasRoute ? routeCoords[routeCoords.length - 1] : null;

  const ecaZones = zones.filter((z) => z.properties.type === "ECA");
  const hraZones = zones.filter((z) => z.properties.type === "HRA");

  // GeoJSON rings are [lon, lat]; Leaflet wants [lat, lon].
  const ring = (z: ZoneFeature): LatLon[] =>
    z.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);

  // Colored leg segments (red where the live weather factor is stormy).
  const k = legsWeather?.length ?? 0;
  const chunks = hasRoute && k > 0 ? legChunks(routeCoords, k) : [];

  return (
    <div className="pruva-card overflow-hidden h-full min-h-[460px]">
      <MapContainer
        center={[25, 40]}
        zoom={3}
        scrollWheelZoom={false}
        style={{ height: "100%", minHeight: "460px", width: "100%" }}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="CARTO Koyu">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="CARTO Voyager">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>

          <LayersControl.Overlay checked name="Deniz İşaretleri (OpenSeaMap)">
            <TileLayer
              attribution='&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>'
              url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
            />
          </LayersControl.Overlay>

          <LayersControl.Overlay checked name="ECA Bölgeleri">
            <LayerGroup>
              {ecaZones.map((z) => (
                <Polygon
                  key={z.properties.name}
                  positions={ring(z)}
                  pathOptions={{
                    color: z.properties.color,
                    weight: 1.5,
                    fillColor: z.properties.color,
                    fillOpacity: 0.12,
                  }}
                >
                  <Tooltip>{z.properties.name}</Tooltip>
                </Polygon>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay checked name="Korsanlık (HRA)">
            <LayerGroup>
              {hraZones.map((z) => (
                <Polygon
                  key={z.properties.name}
                  positions={ring(z)}
                  pathOptions={{
                    color: z.properties.color,
                    weight: 1.5,
                    fillColor: z.properties.color,
                    fillOpacity: 0.15,
                    dashArray: "6 4",
                  }}
                >
                  <Tooltip>{z.properties.name}</Tooltip>
                </Polygon>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>

        {onMapPick && (
          <MapClickPicker pickMode={pickMode} onMapPick={onMapPick} />
        )}

        {hasRoute && (
          <>
            {/* White casing underneath for contrast on the dark basemap. */}
            <Polyline
              positions={routeCoords}
              pathOptions={{ color: CASING, weight: 7, opacity: 0.55 }}
            />
            {chunks.length > 0 ? (
              chunks.map((chunk, i) => {
                const storm = (legsWeather?.[i]?.factor ?? 1.0) > STORM_FACTOR;
                return (
                  <Polyline
                    key={i}
                    positions={chunk}
                    pathOptions={{
                      color: storm ? ROUTE_STORM : ROUTE_TEAL,
                      weight: 4,
                    }}
                  />
                );
              })
            ) : (
              <Polyline
                positions={routeCoords}
                pathOptions={{ color: ROUTE_TEAL, weight: 4 }}
              />
            )}

            {origin && (
              <Marker position={origin} icon={ORIGIN_ICON}>
                <Popup>{originName ?? "Kalkış"}</Popup>
              </Marker>
            )}
            {dest && (
              <Marker position={dest} icon={DEST_ICON}>
                <Popup>{destName ?? "Varış"}</Popup>
              </Marker>
            )}
            <FitBounds coords={routeCoords} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
