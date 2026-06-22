"use client";

import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Bundlers (webpack/Next) break Leaflet's default marker icon: the CSS-relative
// image paths don't survive bundling, so markers render as broken images. The
// fix is to re-point the default icon at the bundled PNG assets explicitly.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x.src,
  iconUrl: markerIcon.src,
  shadowUrl: markerShadow.src,
});

type LatLon = [number, number];

// ECA box from the backend: bbox = [lat_min, lat_max, lon_min, lon_max].
type EcaZone = { name: string; bbox: number[] };

type Props = {
  // The real sea lane as [lat, lon] points (from the /optimize response).
  routeCoords: LatLon[];
  originName?: string;
  destName?: string;
  ecaZones?: EcaZone[];
};

const ROUTE_COLOR = "#2563eb"; // blue: the sea lane
const ECA_COLOR = "#16a34a"; // green: emission control area

// Imperatively fit the map to the route whenever the coordinates change.
function FitBounds({ coords }: { coords: LatLon[] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) {
      map.fitBounds(coords as L.LatLngBoundsExpression, { padding: [20, 20] });
    }
  }, [coords, map]);
  return null;
}

/**
 * Leaflet map of the real sea route: OpenStreetMap tiles, the route polyline,
 * and markers at the origin and destination only. The view auto-fits the route.
 */
export default function RouteMap({
  routeCoords,
  originName,
  destName,
  ecaZones = [],
}: Props) {
  const hasRoute = routeCoords.length > 0;
  const origin = hasRoute ? routeCoords[0] : null;
  const dest = hasRoute ? routeCoords[routeCoords.length - 1] : null;

  return (
    <div className="pruva-card overflow-hidden h-full min-h-[400px]">
      <MapContainer
        center={[25, 40]}
        zoom={3}
        scrollWheelZoom={false}
        style={{ height: "100%", minHeight: "400px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* ECA boxes (semi-transparent green) drawn under the route. */}
        {ecaZones.map((z) => {
          const [latMin, latMax, lonMin, lonMax] = z.bbox;
          const bounds: [LatLon, LatLon] = [
            [latMin, lonMin],
            [latMax, lonMax],
          ];
          return (
            <Rectangle
              key={z.name}
              bounds={bounds}
              pathOptions={{ color: ECA_COLOR, weight: 1, fillOpacity: 0.12 }}
            >
              <Tooltip>{z.name}</Tooltip>
            </Rectangle>
          );
        })}

        {hasRoute && (
          <>
            <Polyline positions={routeCoords} pathOptions={{ color: ROUTE_COLOR, weight: 3 }} />
            {origin && (
              <Marker position={origin}>
                <Popup>{originName ?? "Kalkış"}</Popup>
              </Marker>
            )}
            {dest && (
              <Marker position={dest}>
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
