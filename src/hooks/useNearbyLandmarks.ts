import { useEffect, useState } from 'react';
import { searchNominatim } from '../lib/osm';

export interface NearbyLandmark {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
  categoryLabel: string;
}

export function useNearbyLandmarks(
  center: { lat: number; lng: number } | null,
  enabled: boolean
) {
  const [landmarks, setLandmarks] = useState<NearbyLandmark[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !center) {
      setLandmarks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        const [busStops, stations] = await Promise.all([
          searchNominatim('bus stand', 'in', center).catch(() => []),
          searchNominatim('railway station', 'in', center).catch(() => []),
        ]);
        if (cancelled) return;
        const combined: NearbyLandmark[] = [
          ...busStops.slice(0, 2).map((s) => ({
            id: `bus-${s.placeId}`,
            name: s.mainText,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
            placeId: s.placeId,
            categoryLabel: 'Bus Stand',
          })),
          ...stations.slice(0, 2).map((s) => ({
            id: `rail-${s.placeId}`,
            name: s.mainText,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
            placeId: s.placeId,
            categoryLabel: 'Station',
          })),
        ];
        setLandmarks(combined);
      } catch {
        if (!cancelled) setLandmarks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [center?.lat, center?.lng, enabled]);

  return { landmarks, loading };
}
