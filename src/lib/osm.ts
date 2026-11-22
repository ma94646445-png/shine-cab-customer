import { Coupon, FareEstimate, LocationPoint, VehicleSlug } from '../types/shinecab';

export interface NominatimSearchResult {
  placeId: string;
  mainText: string;
  secondaryText: string;
  address: string;
  lat: number;
  lng: number;
}

export interface OsrmRouteResult {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][]; // [lat, lng]
  isApproximate?: boolean;
}

export interface RawFareConfig {
  id?: string;
  vehicleCategory?: string;
  vehicle_category?: string;
  slug?: string;
  name?: string;
  description?: string;
  capacity?: number;
  baseFare?: number;
  base_fare?: number;
  perKmRate?: number;
  per_km_rate?: number;
  perMinuteRate?: number;
  per_minute_rate?: number;
  minimumFare?: number;
  minimum_fare?: number;
  surgeMultiplier?: number;
  surge_multiplier?: number;
  nightMultiplier?: number;
  night_multiplier?: number;
  cancellationFee?: number;
  cancellation_fee?: number;
  platformFee?: number;
  platform_fee?: number;
  taxRate?: number;
  tax_rate?: number;
  active?: boolean;
  is_active?: boolean;
}

export function computeHaversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

function formatNominatimDisplay(item: Record<string, any>): {
  mainText: string;
  secondaryText: string;
  address: string;
} {
  const addr = item.address || {};
  const primary =
    item.name ||
    addr.village ||
    addr.town ||
    addr.city ||
    addr.suburb ||
    addr.neighbourhood ||
    addr.road ||
    String(item.display_name || '').split(',')[0] ||
    'Selected Location';

  const parts = [
    addr.road && addr.road !== primary ? addr.road : null,
    addr.suburb && addr.suburb !== primary ? addr.suburb : null,
    addr.village && addr.village !== primary ? addr.village : null,
    addr.town && addr.town !== primary ? addr.town : null,
    addr.city && addr.city !== primary ? addr.city : null,
    addr.state_district || addr.county || null,
    addr.state || null,
  ].filter(Boolean);

  const uniqueParts = Array.from(new Set(parts));
  const secondaryText = uniqueParts.join(', ') || String(item.display_name || '');
  const fullAddress =
    uniqueParts.length > 0
      ? `${primary}, ${uniqueParts.slice(0, 4).join(', ')}`
      : String(item.display_name || primary);

  return {
    mainText: primary,
    secondaryText,
    address: fullAddress,
  };
}

export async function searchNominatim(
  query: string,
  countrycodes = 'in',
  biasLocation?: { lat: number; lng: number } | null
): Promise<NominatimSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    format: 'json',
    addressdetails: '1',
    limit: '8',
    countrycodes,
    q: trimmed,
    'accept-language': 'en',
  });

  if (biasLocation) {
    const delta = 0.6;
    params.set(
      'viewbox',
      `${biasLocation.lng - delta},${biasLocation.lat + delta},${biasLocation.lng + delta},${biasLocation.lat - delta}`
    );
  }

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error('Address search unavailable');
  }
  const rows = (await res.json()) as Array<Record<string, any>>;
  return rows
    .filter((r) => r.lat && r.lon)
    .map((r) => {
      const formatted = formatNominatimDisplay(r);
      return {
        placeId: String(r.place_id || `${r.lat}-${r.lon}`),
        mainText: formatted.mainText,
        secondaryText: formatted.secondaryText,
        address: formatted.address,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      };
    });
}

export async function reverseGeocodeNominatim(lat: number, lng: number): Promise<string> {
  try {
    const params = new URLSearchParams({
      format: 'json',
      addressdetails: '1',
      lat: String(lat),
      lon: String(lng),
      'accept-language': 'en',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, any>;
      if (data && (data.address || data.display_name)) {
        return formatNominatimDisplay(data).address;
      }
    }
  } catch {
    // Fallback cleanly below
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export async function fetchOsrmRoute(
  pickup: LocationPoint,
  drop: LocationPoint
): Promise<OsrmRouteResult> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${drop.lng},${drop.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as {
        code?: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry?: { coordinates?: [number, number][] };
        }>;
      };
      const primary = data.routes?.[0];
      if (data.code === 'Ok' && primary) {
        const coords = (primary.geometry?.coordinates || []).map(
          ([lng, lat]): [number, number] => [lat, lng]
        );
        return {
          distanceMeters: Math.max(200, Math.round(primary.distance || 0)),
          durationSeconds: Math.max(120, Math.round(primary.duration || 0)),
          coordinates:
            coords.length >= 2
              ? coords
              : [
                  [pickup.lat, pickup.lng],
                  [drop.lat, drop.lng],
                ],
          isApproximate: false,
        };
      }
    }
  } catch {
    // Fall back gracefully to Haversine straight-line route
  }

  const straightMeters = Math.max(200, computeHaversineMeters(pickup, drop));
  const roadMeters = Math.round(straightMeters * 1.25);
  const estSeconds = Math.max(120, Math.round((roadMeters / 1000 / 26) * 3600));
  return {
    distanceMeters: roadMeters,
    durationSeconds: estSeconds,
    coordinates: [
      [pickup.lat, pickup.lng],
      [drop.lat, drop.lng],
    ],
    isApproximate: true,
  };
}

const DEFAULT_CATEGORY_DEFAULTS: Record<
  VehicleSlug,
  {
    name: string;
    description: string;
    capacity: number;
    baseFare: number;
    perKmRate: number;
    perMinuteRate: number;
    minimumFare: number;
    cancellationFee: number;
  }
> = {
  bike: {
    name: 'Bike',
    description: 'Fast solo two-wheeler pickup',
    capacity: 1,
    baseFare: 15,
    perKmRate: 7,
    perMinuteRate: 0.5,
    minimumFare: 25,
    cancellationFee: 10,
  },
  auto: {
    name: 'Auto',
    description: 'Comfortable 3-wheeler city travel',
    capacity: 3,
    baseFare: 25,
    perKmRate: 11,
    perMinuteRate: 1,
    minimumFare: 40,
    cancellationFee: 15,
  },
  cab: {
    name: 'Cab',
    description: 'AC hatchback & sedan rides',
    capacity: 4,
    baseFare: 45,
    perKmRate: 15,
    perMinuteRate: 1.5,
    minimumFare: 80,
    cancellationFee: 25,
  },
};

export function normalizeSlug(raw?: string | null): VehicleSlug | null {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'bike' || s.includes('moto') || s.includes('two')) return 'bike';
  if (s === 'auto' || s.includes('rickshaw') || s.includes('tuk')) return 'auto';
  if (s === 'cab' || s.includes('car') || s.includes('sedan') || s.includes('suv') || s.includes('mini'))
    return 'cab';
  return null;
}

export function buildFareEstimates(
  fareConfigs: RawFareConfig[],
  distanceMeters: number,
  durationSeconds: number,
  nearbyDriverCounts: Record<VehicleSlug, number>,
  appliedCoupon: Coupon | null
): FareEstimate[] {
  const km = Math.max(0.2, distanceMeters / 1000);
  const mins = Math.max(1, durationSeconds / 60);
  const slugs: VehicleSlug[] = ['bike', 'auto', 'cab'];

  return slugs.map((slug) => {
    const def = DEFAULT_CATEGORY_DEFAULTS[slug];
    const match = fareConfigs.find((cfg) => {
      const activeFlag = cfg.active ?? cfg.is_active ?? true;
      if (activeFlag === false) return false;
      const candidate =
        normalizeSlug(cfg.vehicleCategory) ||
        normalizeSlug(cfg.vehicle_category) ||
        normalizeSlug(cfg.slug) ||
        normalizeSlug(cfg.name) ||
        normalizeSlug(cfg.id);
      return candidate === slug;
    });

    const baseFare = Number(match?.baseFare ?? match?.base_fare ?? def.baseFare);
    const perKmRate = Number(match?.perKmRate ?? match?.per_km_rate ?? def.perKmRate);
    const perMinuteRate = Number(match?.perMinuteRate ?? match?.per_minute_rate ?? def.perMinuteRate);
    const minimumFare = Number(match?.minimumFare ?? match?.minimum_fare ?? def.minimumFare);
    const surgeMultiplier = Math.max(1, Number(match?.surgeMultiplier ?? match?.surge_multiplier ?? 1));
    const cancellationFee = Number(
      match?.cancellationFee ?? match?.cancellation_fee ?? def.cancellationFee
    );
    const platformFee = Number(match?.platformFee ?? match?.platform_fee ?? 0);
    const taxRate = Number(match?.taxRate ?? match?.tax_rate ?? 0);

    const distanceFare = Number((km * perKmRate).toFixed(2));
    const timeFare = Number((mins * perMinuteRate).toFixed(2));
    const rawSubtotal = Math.max(minimumFare, baseFare + distanceFare + timeFare);
    const surgeFare =
      surgeMultiplier > 1 ? Number((rawSubtotal * (surgeMultiplier - 1)).toFixed(2)) : 0;
    const taxAmount = taxRate > 0 ? Number(((rawSubtotal + surgeFare) * (taxRate / 100)).toFixed(2)) : 0;
    const preDiscount = rawSubtotal + surgeFare + platformFee + taxAmount;

    let discountAmount = 0;
    if (
      appliedCoupon &&
      preDiscount >= Number(appliedCoupon.min_ride_amount || 0) &&
      (!appliedCoupon.applicable_category_slug || appliedCoupon.applicable_category_slug === slug)
    ) {
      if (appliedCoupon.discount_type === 'percentage') {
        discountAmount = (preDiscount * Number(appliedCoupon.discount_value || 0)) / 100;
        if (appliedCoupon.max_discount && appliedCoupon.max_discount > 0) {
          discountAmount = Math.min(discountAmount, Number(appliedCoupon.max_discount));
        }
      } else {
        discountAmount = Number(appliedCoupon.discount_value || 0);
      }
      discountAmount = Number(Math.min(preDiscount, Math.max(0, discountAmount)).toFixed(2));
    }

    const totalFare = Math.max(
      minimumFare - discountAmount,
      Math.round(preDiscount - discountAmount)
    );

    return {
      categoryId: match?.id || slug,
      slug,
      name: match?.name || def.name,
      description: match?.description || def.description,
      capacity: Number(match?.capacity || def.capacity),
      baseFare,
      distanceFare,
      timeFare,
      nightFare: 0,
      surgeFare,
      platformFee,
      taxAmount,
      discountAmount,
      totalFare: Math.max(0, totalFare),
      surgeMultiplier,
      cancellationFee,
      availableDrivers: nearbyDriverCounts[slug] || 0,
      perKmRate,
      isStandardTariff: false,
    };
  });
}
