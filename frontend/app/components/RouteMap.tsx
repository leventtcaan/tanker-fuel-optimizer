"use client";

import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Bundlers (webpack/Next) break Leaflet's default marker icon: the CSS-relative
// image paths don't survive bundling, so markers render as broken images. The
// fix is to re-point the default icon at the bundled PNG assets explicitly.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { WAYPOINTS } from "../lib/voyageRoute";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x.src,
  iconUrl: markerIcon.src,
  shadowUrl: markerShadow.src,
});

type Props = {
  // One weather factor per leg (consecutive waypoint pair); >1.0 = storm.
  weather?: number[];
};

const STORM_COLOR = "#ef4444"; // red: storm segment (weather > 1.0)
const CALM_COLOR = "#3b82f6"; // blue: calm segment

/**
 * Leaflet map of the voyage: OpenStreetMap tiles, a marker per waypoint, and a
 * polyline whose segments are colored by weather (red for storm, blue calm).
 */
export default function RouteMap({ weather = [1.0, 1.4, 1.0] }: Props) {
  // Map center roughly in the middle of the Mediterranean route.
  const center: [number, number] = [37.5, 10.0];

  return (
    <div className="border rounded overflow-hidden">
      <MapContainer
        center={center}
        zoom={5}
        scrollWheelZoom={false}
        style={{ height: "400px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {WAYPOINTS.map((wp) => (
          <Marker key={wp.name} position={[wp.lat, wp.lon]}>
            <Popup>{wp.name}</Popup>
          </Marker>
        ))}

        {/* One polyline per leg so each segment can carry its own weather color. */}
        {WAYPOINTS.slice(0, -1).map((wp, i) => {
          const next = WAYPOINTS[i + 1];
          const isStorm = (weather[i] ?? 1.0) > 1.0;
          return (
            <Polyline
              key={`seg-${i}`}
              positions={[
                [wp.lat, wp.lon],
                [next.lat, next.lon],
              ]}
              pathOptions={{ color: isStorm ? STORM_COLOR : CALM_COLOR, weight: 4 }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
