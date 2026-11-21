import React, { useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Navigation, ShieldCheck, AlertTriangle } from 'lucide-react';
import { AppConfig } from '../types/shinecab';
import { ShineCabLogo } from './ShineCabLogo';
import { RideMapCanvas } from './RideMapCanvas';

interface SharedTripViewProps {
  token: string;
  config: AppConfig;
  onExitShare: () => void;
}

interface SharedTripData {
  id: string;
  ride_code: string;
  status: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  vehicle_categories?: { name: string; slug: 'bike' | 'auto' | 'cab' } | null;
  drivers?: {
    rating_avg: number;
    current_lat: number | null;
    current_lng: number | null;
    users?: { full_name: string | null } | null;
  } | null;
  vehicles?: {
    make: string;
    model: string;
    color: string;
    registration_number: string;
  } | null;
}

export const SharedTripView: React.FC<SharedTripViewProps> = ({
  token,
  config,
  onExitShare,
}) => {
  const [trip, setTrip] = useState<SharedTripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchTrip = async () => {
      try {
        const res = await fetch(`/api/trips/share/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!active) return;
        if (!res.ok || !data.trip) {
          setError(data.error || 'Shared trip link is invalid or expired.');
        } else {
          setTrip(data.trip);
        }
      } catch {
        if (active) setError('Unable to load shared trip.');
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchTrip();
    const poll = setInterval(fetchTrip, 10000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [token]);

  return (
    <div className="flex-1 min-h-0 bg-[#F7F8FA] flex flex-col overflow-hidden">
      <header className="h-[52px] bg-white border-b border-neutral-200 px-3.5 flex items-center justify-between gap-3 shrink-0">
        <ShineCabLogo size="sm" />
        <button
          type="button"
          onClick={onExitShare}
          className="min-h-[38px] px-3 rounded-xl bg-[#111111] text-[#FFC928] text-xs font-semibold cursor-pointer"
        >
          Open SHINE CAB
        </button>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center p-6 text-sm text-[#737373]">
          Loading shared trip...
        </div>
      ) : error || !trip ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
          <AlertTriangle className="w-8 h-8 text-[#DC2626]" />
          <p className="font-display font-bold text-base text-[#111111]">
            {error || 'Shared trip unavailable.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="h-[54%] shrink-0">
            {config.services.maps ? (
              <APIProvider apiKey={config.googleMapsApiKey} language="en" region="IN">
                <RideMapCanvas
                  pickup={{
                    address: trip.pickup_address,
                    lat: trip.pickup_lat,
                    lng: trip.pickup_lng,
                  }}
                  drop={{
                    address: trip.drop_address,
                    lat: trip.drop_lat,
                    lng: trip.drop_lng,
                  }}
                  driverLocation={
                    trip.drivers?.current_lat && trip.drivers?.current_lng
                      ? { lat: trip.drivers.current_lat, lng: trip.drivers.current_lng }
                      : null
                  }
                  pinSelectMode={null}
                  onRequestCurrentGps={() => {}}
                />
              </APIProvider>
            ) : (
              <div className="w-full h-full bg-neutral-100 flex items-center justify-center text-xs text-[#737373]">
                Service configuration required. Please contact support.
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 -mt-4 rounded-t-3xl bg-white p-4 space-y-3.5 border-t border-neutral-200 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] overflow-y-auto relative z-10">
            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto" />
            <div className="flex items-center gap-2 text-xs text-[#16A34A] font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Live Trip Tracking · {trip.ride_code}</span>
            </div>
            <h1 className="font-display text-lg font-bold text-[#111111] capitalize">
              {trip.status.replace(/_/g, ' ')}
            </h1>
            <div className="rounded-2xl bg-[#F7F8FA] p-3.5 space-y-2 text-xs">
              <p>
                <strong>Pickup:</strong> {trip.pickup_address}
              </p>
              <p>
                <strong>Destination:</strong> {trip.drop_address}
              </p>
            </div>
            {trip.drivers && trip.vehicles && (
              <div className="rounded-2xl border border-neutral-200 p-3.5 space-y-1 text-xs">
                <p className="font-bold text-[#111111] flex items-center gap-1.5">
                  <Navigation className="w-4 h-4 text-[#FFC928]" />
                  <span>{trip.drivers.users?.full_name || 'Verified Driver'}</span>
                </p>
                <p className="text-[#737373]">
                  {trip.vehicles.color} {trip.vehicles.make} {trip.vehicles.model} ·{' '}
                  <span className="font-mono-num font-bold text-[#111111]">
                    {trip.vehicles.registration_number}
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
