import React, { useEffect, useState } from 'react';
import { Search, MapPin, Home, Briefcase, Clock, X, Crosshair } from 'lucide-react';
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

interface OsmResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export const LocationSearchModal: React.FC<LocationSearchModalProps> = ({
  mode,
  savedAddresses,
  recentDestinations,
  biasLocation,
  onSelectLocation,
  onSelectOnMap,
  onUseCurrentGps,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OsmResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const viewbox = biasLocation
          ? `&viewbox=${biasLocation.lng - 1.5},${biasLocation.lat + 1.5},${biasLocation.lng + 1.5},${biasLocation.lat - 1.5}`
          : '';
        const res = await fetch(
          `https://openstreetmap.org{encodeURIComponent(q)}${viewbox}`
        );
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query, biasLocation]);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col pt-8">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center text-[#111111]"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'pickup' ? 'Search pickup village, road or city...' : 'Search drop destination...'}
            className="w-full h-11 pl-9 pr-3 rounded-xl bg-neutral-100 text-sm text-[#111111] outline-none focus:ring-2 focus:ring-[#FFC928]"
          />
        </div>
      </div>

      <div className="px-4 py-2.5 border-b border-neutral-100 flex gap-2">
        {mode === 'pickup' && onUseCurrentGps && (
          <button
            type="button"
            onClick={() => {
              onUseCurrentGps();
              onClose();
            }}
            className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center justify-center gap-1.5"
          >
            <Crosshair className="w-4 h-4" />
            Current GPS
          </button>
        )}
        <button
          type="button"
          onClick={onSelectOnMap}
          className="flex-1 py-2.5 px-3 rounded-xl bg-amber-50 text-amber-800 text-xs font-bold flex items-center justify-center gap-1.5"
        >
          <MapPin className="w-4 h-4" />
          Choose on Map
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
        {isLoading && (
          <div className="p-5 text-center text-xs text-neutral-500">Searching locations...</div>
        )}

        {results.map((item) => {
          const parts = item.display_name.split(',');
          const title = parts || item.display_name;
          const subtitle = parts.slice(1, 4).join(',').trim();
          return (
            <button
              key={item.place_id}
              type="button"
              onClick={() =>
                onSelectLocation({
                  address: item.display_name,
                  lat: Number(item.lat),
                  lng: Number(item.lon),
                  placeId: String(item.place_id),
                })
              }
              className="w-full px-4 py-3.5 text-left flex items-start gap-3 hover:bg-neutral-50"
            >
              <MapPin className="w-4 h-4 text-[#FFC928] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#111111] truncate">{title}</p>
                <p className="text-xs text-neutral-500 truncate">{subtitle}</p>
              </div>
            </button>
          );
        })}

        {query.trim().length < 2 && savedAddresses.length > 0 && (
          <div className="p-4 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Saved Places</p>
            {savedAddresses.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectLocation({ address: s.address, lat: s.lat, lng: s.lng })}
                className="w-full py-2.5 flex items-center gap-3 text-left"
              >
                {s.label === 'home' ? <Home className="w-4 h-4 text-neutral-600" /> : <Briefcase className="w-4 h-4 text-neutral-600" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-[#111111] capitalize">{s.label}</p>
                  <p className="text-xs text-neutral-500 truncate">{s.address}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {query.trim().length < 2 && recentDestinations.length > 0 && (
          <div className="p-4 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Recent Destinations</p>
            {recentDestinations.map((r, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectLocation(r)}
                className="w-full py-2.5 flex items-center gap-3 text-left"
              >
                <Clock className="w-4 h-4 text-neutral-400 shrink-0" />
                <p className="text-xs text-[#111111] truncate">{r.address}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
