// ============================================================
// Clock chart — IANA zone → representative coordinates (DATA, not a dep)
// ============================================================
//
// A trimmed, public-domain subset of the IANA `zone.tab` (tz database):
// representative city latitude/longitude for the common time zones. Used ONLY
// to place the sundown/sunrise line — a zone absent here still renders (correct
// time, no sun line). Coordinates are to ~2 decimals (city-center precision is
// plenty for civil sunrise/sunset).
//
// Keep this a plain data map with zero imports so it bundles into the tiny
// browser ticker entry alongside resolve.ts.

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export const ZONE_COORDS: Record<string, LatLon> = {
  // ── North America ──
  'America/New_York': { lat: 40.71, lon: -74.01 },
  'America/Detroit': { lat: 42.33, lon: -83.05 },
  'America/Toronto': { lat: 43.65, lon: -79.38 },
  'America/Montreal': { lat: 45.51, lon: -73.57 },
  'America/Chicago': { lat: 41.85, lon: -87.65 },
  'America/Winnipeg': { lat: 49.9, lon: -97.14 },
  'America/Mexico_City': { lat: 19.43, lon: -99.13 },
  'America/Denver': { lat: 39.74, lon: -104.98 },
  'America/Phoenix': { lat: 33.45, lon: -112.07 },
  'America/Edmonton': { lat: 53.55, lon: -113.5 },
  'America/Los_Angeles': { lat: 34.05, lon: -118.24 },
  'America/Vancouver': { lat: 49.28, lon: -123.12 },
  'America/Tijuana': { lat: 32.53, lon: -117.02 },
  'America/Anchorage': { lat: 61.22, lon: -149.9 },
  'America/Adak': { lat: 51.88, lon: -176.66 },
  'Pacific/Honolulu': { lat: 21.31, lon: -157.86 },
  'America/Halifax': { lat: 44.65, lon: -63.57 },
  'America/St_Johns': { lat: 47.56, lon: -52.71 },
  'America/Havana': { lat: 23.13, lon: -82.36 },
  'America/Panama': { lat: 8.98, lon: -79.52 },
  'America/Guatemala': { lat: 14.61, lon: -90.53 },
  'America/Costa_Rica': { lat: 9.93, lon: -84.08 },

  // ── South America ──
  'America/Bogota': { lat: 4.61, lon: -74.08 },
  'America/Lima': { lat: -12.05, lon: -77.05 },
  'America/Caracas': { lat: 10.5, lon: -66.93 },
  'America/La_Paz': { lat: -16.5, lon: -68.15 },
  'America/Santiago': { lat: -33.45, lon: -70.67 },
  'America/Argentina/Buenos_Aires': { lat: -34.6, lon: -58.45 },
  'America/Montevideo': { lat: -34.88, lon: -56.18 },
  'America/Asuncion': { lat: -25.28, lon: -57.67 },
  'America/Sao_Paulo': { lat: -23.53, lon: -46.62 },
  'America/Bahia': { lat: -12.97, lon: -38.51 },
  'America/Manaus': { lat: -3.13, lon: -60.02 },
  'America/Guayaquil': { lat: -2.17, lon: -79.83 },

  // ── Europe ──
  'Europe/London': { lat: 51.51, lon: -0.13 },
  'Europe/Dublin': { lat: 53.33, lon: -6.25 },
  'Europe/Lisbon': { lat: 38.72, lon: -9.13 },
  'Europe/Madrid': { lat: 40.42, lon: -3.7 },
  'Europe/Paris': { lat: 48.85, lon: 2.35 },
  'Europe/Brussels': { lat: 50.85, lon: 4.35 },
  'Europe/Amsterdam': { lat: 52.37, lon: 4.89 },
  'Europe/Berlin': { lat: 52.52, lon: 13.4 },
  'Europe/Zurich': { lat: 47.38, lon: 8.54 },
  'Europe/Rome': { lat: 41.9, lon: 12.5 },
  'Europe/Vienna': { lat: 48.21, lon: 16.37 },
  'Europe/Prague': { lat: 50.09, lon: 14.42 },
  'Europe/Warsaw': { lat: 52.23, lon: 21.01 },
  'Europe/Stockholm': { lat: 59.33, lon: 18.06 },
  'Europe/Oslo': { lat: 59.91, lon: 10.75 },
  'Europe/Copenhagen': { lat: 55.68, lon: 12.57 },
  'Europe/Helsinki': { lat: 60.17, lon: 24.94 },
  'Europe/Athens': { lat: 37.98, lon: 23.73 },
  'Europe/Bucharest': { lat: 44.43, lon: 26.1 },
  'Europe/Budapest': { lat: 47.5, lon: 19.04 },
  'Europe/Kyiv': { lat: 50.45, lon: 30.52 },
  'Europe/Kiev': { lat: 50.45, lon: 30.52 },
  'Europe/Istanbul': { lat: 41.01, lon: 28.98 },
  'Europe/Moscow': { lat: 55.76, lon: 37.62 },
  'Europe/Reykjavik': { lat: 64.15, lon: -21.95 },

  // ── Africa ──
  'Africa/Casablanca': { lat: 33.57, lon: -7.59 },
  'Africa/Lagos': { lat: 6.45, lon: 3.4 },
  'Africa/Accra': { lat: 5.56, lon: -0.2 },
  'Africa/Algiers': { lat: 36.75, lon: 3.06 },
  'Africa/Tunis': { lat: 36.8, lon: 10.18 },
  'Africa/Cairo': { lat: 30.04, lon: 31.24 },
  'Africa/Johannesburg': { lat: -26.2, lon: 28.05 },
  'Africa/Nairobi': { lat: -1.29, lon: 36.82 },
  'Africa/Addis_Ababa': { lat: 9.03, lon: 38.74 },
  'Africa/Khartoum': { lat: 15.5, lon: 32.56 },
  'Africa/Kinshasa': { lat: -4.32, lon: 15.31 },
  'Africa/Dakar': { lat: 14.69, lon: -17.44 },
  'Africa/Harare': { lat: -17.83, lon: 31.05 },
  'Indian/Mauritius': { lat: -20.16, lon: 57.5 },

  // ── Middle East / West + Central Asia ──
  'Asia/Jerusalem': { lat: 31.78, lon: 35.22 },
  'Asia/Beirut': { lat: 33.89, lon: 35.5 },
  'Asia/Amman': { lat: 31.95, lon: 35.93 },
  'Asia/Riyadh': { lat: 24.71, lon: 46.68 },
  'Asia/Qatar': { lat: 25.29, lon: 51.53 },
  'Asia/Dubai': { lat: 25.2, lon: 55.27 },
  'Asia/Baghdad': { lat: 33.31, lon: 44.36 },
  'Asia/Tehran': { lat: 35.69, lon: 51.39 },
  'Asia/Baku': { lat: 40.41, lon: 49.87 },
  'Asia/Yerevan': { lat: 40.18, lon: 44.51 },
  'Asia/Tbilisi': { lat: 41.72, lon: 44.79 },
  'Asia/Karachi': { lat: 24.86, lon: 67.01 },
  'Asia/Tashkent': { lat: 41.31, lon: 69.28 },
  'Asia/Almaty': { lat: 43.25, lon: 76.95 },

  // ── South + Southeast Asia ──
  'Asia/Kolkata': { lat: 22.57, lon: 88.36 },
  'Asia/Calcutta': { lat: 22.57, lon: 88.36 },
  'Asia/Colombo': { lat: 6.93, lon: 79.85 },
  'Asia/Kathmandu': { lat: 27.72, lon: 85.32 },
  'Asia/Dhaka': { lat: 23.81, lon: 90.41 },
  'Asia/Yangon': { lat: 16.8, lon: 96.15 },
  'Asia/Bangkok': { lat: 13.75, lon: 100.5 },
  'Asia/Ho_Chi_Minh': { lat: 10.82, lon: 106.63 },
  'Asia/Jakarta': { lat: -6.21, lon: 106.85 },
  'Asia/Kuala_Lumpur': { lat: 3.14, lon: 101.69 },
  'Asia/Singapore': { lat: 1.29, lon: 103.85 },
  'Asia/Manila': { lat: 14.6, lon: 120.98 },

  // ── East Asia ──
  'Asia/Hong_Kong': { lat: 22.32, lon: 114.17 },
  'Asia/Shanghai': { lat: 31.23, lon: 121.47 },
  'Asia/Taipei': { lat: 25.03, lon: 121.57 },
  'Asia/Seoul': { lat: 37.57, lon: 126.98 },
  'Asia/Tokyo': { lat: 35.68, lon: 139.69 },
  'Asia/Ulaanbaatar': { lat: 47.92, lon: 106.92 },
  'Asia/Vladivostok': { lat: 43.12, lon: 131.9 },

  // ── Australia / Pacific ──
  'Australia/Perth': { lat: -31.95, lon: 115.86 },
  'Australia/Adelaide': { lat: -34.93, lon: 138.6 },
  'Australia/Darwin': { lat: -12.46, lon: 130.84 },
  'Australia/Brisbane': { lat: -27.47, lon: 153.03 },
  'Australia/Sydney': { lat: -33.87, lon: 151.21 },
  'Australia/Melbourne': { lat: -37.81, lon: 144.96 },
  'Australia/Hobart': { lat: -42.88, lon: 147.33 },
  'Pacific/Auckland': { lat: -36.85, lon: 174.76 },
  'Pacific/Fiji': { lat: -18.14, lon: 178.44 },
  'Pacific/Guam': { lat: 13.47, lon: 144.75 },
  'Pacific/Port_Moresby': { lat: -9.5, lon: 147.15 },
  'Pacific/Tongatapu': { lat: -21.13, lon: -175.2 },

  // ── UTC ──
  UTC: { lat: 51.48, lon: 0 },
};

/** Representative coordinates for `zone`, or null when unknown. */
export function coordsFor(zone: string): LatLon | null {
  return ZONE_COORDS[zone] ?? null;
}
