import { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

export function useAutocompleteSuggestions(
  inputString: string,
  locationBias?: { lat: number; lng: number } | null
) {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!placesLib) return;
    const trimmed = inputString.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setError(null);
      return;
    }

    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const request: google.maps.places.AutocompleteRequest = {
          input: trimmed,
          sessionToken: sessionTokenRef.current!,
          ...(locationBias
            ? {
                origin: { lat: locationBias.lat, lng: locationBias.lng },
              }
            : {}),
        };
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        if (!cancelled) {
          setSuggestions(res.suggestions || []);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('OVER_QUERY_LIMIT') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          setError('Unable to fetch address suggestions right now.');
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placesLib, inputString, locationBias?.lat, locationBias?.lng]);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  return { suggestions, isLoading, error, resetSession };
}
