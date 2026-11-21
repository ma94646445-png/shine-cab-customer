import React, { useState } from 'react';
import { Search, MapPin, Home, Briefcase, Clock, X, Crosshair } from 'lucide-react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { LocationPoint, SavedAddress } from '../types/shinecab';

interface LocationSearchModalProps {
  mode: 'pickup' | 'drop';
  savedAddresses: SavedAddress[];
  recentDestinations: LocationPoint[];
  biasLocation: { lat: number; lng: number } | null;
  mapsEnabled: boolean;
  onSelectLocation: (loc: LocationPoint) => void;
  onSelectOnMap: () => void;
  onUseCurrentGps?: () => void;
  onClose: () => void;
}

export const LocationSearchModal: React.FC<LocationSearchModalProps> = ({
  mode,
  savedAddresses,
  recentDestinations,
  biasLocation,
  mapsEnabled,
  onSelectLocation,
  onSelectOnMap,
  onUseCurrentGps,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placesLib = useMapsLibrary('places');
  const { suggestions, isLoading, error: acError, resetSession } = useAutocompleteSuggestions(
    query,
    biasLocation
  );

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;
    setSelecting(true);
    setError(null);
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const loc = place.location;
      if (!loc) {
        setError('Selected place does not have valid coordinates.');
        return;
      }
      onSelectLocation({
        address: place.formattedAddress || place.displayName || suggestion.placePrediction.text.text,
        lat: loc.lat(),
        lng: loc.lng(),
        placeId: place.id,
      });
      resetSession();
    } catch {
      setError('Failed to fetch coordinates for this location.');
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center">
      <div className="bg-white w-full rounded-t-3xl shadow-2xl border-t border-neutral-200 h-[88%] flex flex-col overflow-hidden">
        <div className="pt-2.5 flex justify-center shrink-0">
          <div className="w-10 h-1 bg-neutral-300 rounded-full" />
        </div>
        <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between gap-3 shrink-0">
          <h3 className="font-display text-base font-bold text-[#111111]">
            {mode === 'pickup' ? 'Select Pickup Location' : 'Where are you going?'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-neutral-100">
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mapsEnabled
                  ? `Search ${mode === 'pickup' ? 'pickup' : 'destination'} address or landmark`
                  : 'Maps API key required for address autocomplete'
              }
              disabled={!mapsEnabled}
              className="w-full h-12 rounded-xl border border-neutral-300 bg-[#F7F8FA] pl-10 pr-4 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928] disabled:opacity-60"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {mode === 'pickup' && onUseCurrentGps && (
              <button
                type="button"
                onClick={() => {
                  onUseCurrentGps();
                  onClose();
                }}
                className="min-h-[44px] px-3.5 rounded-xl bg-[#FFC928]/20 text-[#111111] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#FFC928]/35 cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Use Current GPS</span>
              </button>
            )}
            <button
              type="button"
              onClick={onSelectOnMap}
              className="min-h-[44px] px-3.5 rounded-xl bg-neutral-100 text-[#111111] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-200 cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Select on Map</span>
            </button>
          </div>

          {(error || acError) && (
            <p className="text-xs text-[#DC2626] font-medium">{error || acError}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {(isLoading || selecting) && (
            <div className="space-y-2">
              <div className="h-12 bg-neutral-100 rounded-xl animate-pulse" />
              <div className="h-12 bg-neutral-100 rounded-xl animate-pulse" />
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#737373] px-1 mb-2">Suggestions</p>
              {suggestions.map((s, idx) => (
                <button
                  key={`${s.placePrediction?.placeId || idx}`}
                  type="button"
                  onClick={() => handleSelectSuggestion(s)}
                  className="w-full min-h-[52px] flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-[#F7F8FA] text-left transition cursor-pointer"
                >
                  <MapPin className="w-4 h-4 text-[#111111] mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#111111] truncate">
                      {s.placePrediction?.mainText?.text || s.placePrediction?.text.text}
                    </p>
                    {s.placePrediction?.secondaryText?.text && (
                      <p className="text-xs text-[#737373] truncate">
                        {s.placePrediction.secondaryText.text}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {savedAddresses.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#737373] px-1 mb-2">Saved Places</p>
              {savedAddresses.map((addr) => (
                <button
                  key={addr.id}
                  type="button"
                  onClick={() =>
                    onSelectLocation({
                      address: addr.address_line,
                      lat: addr.lat,
                      lng: addr.lng,
                      placeId: addr.place_id || undefined,
                    })
                  }
                  className="w-full min-h-[52px] flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#F7F8FA] text-left cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center shrink-0">
                    {addr.address_type === 'home' ? (
                      <Home className="w-4 h-4 text-[#111111]" />
                    ) : addr.address_type === 'office' ? (
                      <Briefcase className="w-4 h-4 text-[#111111]" />
                    ) : (
                      <MapPin className="w-4 h-4 text-[#111111]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#111111]">{addr.label}</p>
                    <p className="text-xs text-[#737373] truncate">{addr.address_line}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {recentDestinations.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#737373] px-1 mb-2">Recent Destinations</p>
              {recentDestinations.map((rec, i) => (
                <button
                  key={`${rec.lat}-${rec.lng}-${i}`}
                  type="button"
                  onClick={() => onSelectLocation(rec)}
                  className="w-full min-h-[52px] flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#F7F8FA] text-left cursor-pointer"
                >
                  <Clock className="w-4 h-4 text-[#737373] shrink-0" />
                  <span className="text-sm text-[#111111] truncate">{rec.address}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
