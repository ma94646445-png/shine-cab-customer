import { useEffect, useState } from 'react';
import { NominatimSearchResult, searchNominatim } from '../lib/osm';

export function useAutocompleteSuggestions(
  query: string,
  biasLocation?: { lat: number; lng: number } | null
) {
  const [suggestions, setSuggestions] = useState<NominatimSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const results = await searchNominatim(trimmed, 'in', biasLocation);
        if (!cancelled) {
          setSuggestions(results);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setError('Unable to fetch location suggestions right now.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, biasLocation?.lat, biasLocation?.lng]);

  const resetSession = () => {
    setSuggestions([]);
  };

  return { suggestions, isLoading, error, resetSession };
}
