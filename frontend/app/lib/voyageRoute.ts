// Voyage route helpers: real Mediterranean waypoints, great-circle distances,
// and leg construction. Pure geometry — no optimizer/CII logic lives here.

export type Waypoint = {
  name: string;
  lat: number;
  lon: number;
};

export type Leg = {
  distance_nm: number;
  weather: number;
};

// A real westbound-to-eastbound Mediterranean route: Strait of Gibraltar to
// Aliağa (İzmir), passing west of Sardinia and south of Sicily.
export const WAYPOINTS: Waypoint[] = [
  { name: "Gibraltar", lat: 36.0, lon: -5.6 },
  { name: "Sardunya açıkları", lat: 38.5, lon: 8.5 },
  { name: "Sicilya açıkları", lat: 36.5, lon: 14.0 },
  { name: "Aliağa, İzmir", lat: 38.8, lon: 26.9 },
];

// Earth's mean radius in nautical miles, used for great-circle distances.
const EARTH_RADIUS_NM = 3440.065;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two waypoints, in nautical miles (haversine).
 *
 * The haversine formula gives the shortest distance over the Earth's surface
 * between two lat/lon points, treating the Earth as a sphere of radius
 * EARTH_RADIUS_NM. This is what a ship's leg distance approximates.
 */
export function haversine(a: Waypoint, b: Waypoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_NM * c;
}

/**
 * Build voyage legs from the WAYPOINTS, one per consecutive waypoint pair.
 *
 * With 4 waypoints this yields 3 legs. Each leg's distance is the haversine
 * great-circle distance between its endpoints; its weather is taken from the
 * `weather` array by index (default [1.0, 1.4, 1.0] = a storm on the middle leg).
 */
export function buildLegs(weather: number[] = [1.0, 1.4, 1.0]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    legs.push({
      distance_nm: haversine(WAYPOINTS[i], WAYPOINTS[i + 1]),
      weather: weather[i] ?? 1.0,
    });
  }
  return legs;
}
