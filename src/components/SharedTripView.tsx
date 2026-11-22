import React, { useEffect, useState } from 'react';
import { Navigation, ShieldCheck, AlertTriangle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ShineCabLogo } from './ShineCabLogo';
import { RideMapCanvas } from './RideMapCanvas';

interface SharedTripViewProps {
  token: string;
  googleMapsApiKey?: string;
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
  driver_name?: string | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  vehicle_label?: string | null;
  registration_number?: string | null;
}

export const SharedTripView: React.FC<SharedTripViewProps> = ({
  token,
  googleMapsApiKey,
  onExitShare,
}) => {
  const [trip, setTrip] = useState<SharedTripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = `shared_trips/${token}`;
    const unsub = onSnapshot(
      doc(db, 'shared_trips', token),
      (snap) => {
        if (!snap.exists()) {
          setTrip(null);
          setError('Shared trip link is invalid or expired.');
        } else {
          setTrip(snap.data() as SharedTripData);
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setError('Unable to load shared trip.');
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch {
          // logged
        }
      }
    );

    return () => unsub();
  }, [token]);

  return (
    <div className="flex-1 min-h-0 bg-[#F7F8FA] flex flex-col overflow-hidden">
      <header className="h-[52px] bg-white border-b border-neutral-200 px-3.5 flex items-center justify-between gap-3 shrink-0">
        <ShineCabLogo size="sm" />
        <button
          type="button"
          onClick={onExitShare}
          className="min-h-[38px] px-3 rounded-xl bg-[#111111] text-[#F5C518] text-xs font-semibold cursor-pointer"
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
            <RideMapCanvas
              googleMapsApiKey={googleMapsApiKey}
              isActiveRide
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
                trip.driver_lat && trip.driver_lng
                  ? { lat: trip.driver_lat, lng: trip.driver_lng }
                  : null
              }
              pinSelectMode={null}
              onRequestCurrentGps={() => {}}
            />
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
            {trip.driver_name && (
              <div className="rounded-2xl border border-neutral-200 p-3.5 space-y-1 text-xs">
                <p className="font-bold text-[#111111] flex items-center gap-1.5">
                  <Navigation className="w-4 h-4 text-[#F5C518]" />
                  <span>{trip.driver_name}</span>
                </p>
                <p className="text-[#737373]">
                  {trip.vehicle_label || 'Verified Vehicle'}{' '}
                  {trip.registration_number && (
                    <span className="font-mono-num font-bold text-[#111111]">
                      · {trip.registration_number}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
