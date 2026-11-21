import { useEffect, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { LocationPoint } from '../types/shinecab';

export interface NearbyLandmark extends LocationPoint {
  id: string;
  name: string;
  categoryLabel: string;
}

const TYPE_LABELS: Record<string, string> = {
  train_station: 'Railway Station',
  subway_station: 'Metro Station',
  bus_station: 'Bus Terminal',
  airport: 'Airport',
  shopping_mall: 'Shopping Mall',
  hospital: 'Hospital',
};

export function useNearbyLandmarks(
  center: { lat: number; lng: number } | null,
  enabled: boolean
) {
  const placesLib = useMapsLibrary('places');
  const [landmarks, setLandmarks] = useState<NearbyLandmark[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !placesLib || !center) {
      return;
    }

    const PlaceClass = placesLib.Place as typeof google.maps.places.Place | undefined;
    if (!PlaceClass || typeof PlaceClass.searchNearby !== 'function') {
      return;
    }

    let cancelled = false;
    setLoading(true);

    PlaceClass.searchNearby({
      fields: ['id', 'displayName', 'formattedAddress', 'location', 'primaryType'],
      locationRestriction: {
        center: { lat: center.lat, lng: center.lng },
        radius: 5000,
      },
      includedPrimaryTypes: [
        'train_station',
        'subway_station',
        'bus_station',
        'airport',
        'shopping_mall',
        'hospital',
      ],
      maxResultCount: 5,
      rankPreference: 'POPULARITY',
    })
      .then((res) => {
        if (cancelled) return;
        const list: NearbyLandmark[] = [];
        for (const p of res.places || []) {
          if (!p.location || !p.displayName) continue;
          const primaryType = p.primaryType || '';
          list.push({
            id: p.id || `${p.location.lat()}-${p.location.lng()}`,
            name: p.displayName,
            address: p.formattedAddress || p.displayName,
            lat: p.location.lat(),
            lng: p.location.lng(),
            placeId: p.id,
            categoryLabel: TYPE_LABELS[primaryType] || 'Nearby Place',
          });
        }
        setLandmarks(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setLandmarks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [placesLib, center?.lat, center?.lng, enabled]);

  return { landmarks, loading };
}
