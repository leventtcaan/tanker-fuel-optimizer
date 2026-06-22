"use client";

import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
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

type Props = {
  // The real sea lane as [lat, lon] points (from the /optimize response).
  routeCoords: LatLon[];
  originName?: string;
  destName?: string;
};

const ROUTE_COLOR = "#2563eb"; // blue: the sea lane

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
export default function RouteMap({ routeCoords, originName, destName }: Props) {
  const hasRoute = routeCoords.length > 0;
  const origin = hasRoute ? routeCoords[0] : null;
  const dest = hasRoute ? routeCoords[routeCoords.length - 1] : null;

  return (
    <div className="border rounded overflow-hidden">
      <MapContainer
        center={[25, 40]}
        zoom={3}
        scrollWheelZoom={false}
        style={{ height: "400px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

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
