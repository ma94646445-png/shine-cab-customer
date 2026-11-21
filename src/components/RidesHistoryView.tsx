import React, { useState } from 'react';
import {
  CalendarClock,
  Receipt,
  LifeBuoy,
  X,
  Star,
  Phone,
  MessageSquare,
  Car,
} from 'lucide-react';
import { SupabaseClient } from '@supabase/supabase-js';
import { RideRecord, ScheduledRide } from '../types/shinecab';

interface RidesHistoryViewProps {
  rides: RideRecord[];
  scheduledRides: ScheduledRide[];
  loading: boolean;
  supabase: SupabaseClient | null;
  onRefresh: () => void;
  onCreateSupportForRide: (rideId: string) => void;
  onOpenDriverChat?: (rideId: string) => void;
}

type HistoryTab = 'all' | 'driver_history' | 'completed' | 'cancelled' | 'upcoming';

export const RidesHistoryView: React.FC<RidesHistoryViewProps> = ({
  rides,
  scheduledRides,
  loading,
  supabase,
  onRefresh,
  onCreateSupportForRide,
  onOpenDriverChat,
}) => {
  const [tab, setTab] = useState<HistoryTab>('all');
  const [selectedRide, setSelectedRide] = useState<RideRecord | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const filteredRides = rides.filter((r) => {
    if (tab === 'driver_history') return Boolean(r.drivers || r.driver_id);
    if (tab === 'completed') return ['ride_completed', 'payment_completed'].includes(r.status);
    if (tab === 'cancelled') return ['cancelled', 'failed'].includes(r.status);
    return tab === 'all';
  });

  const handleCancelScheduled = async (id: string) => {
    if (!supabase) return;
    setCancellingId(id);
    try {
      await supabase
        .from('scheduled_rides')
        .update({ status: 'cancelled', cancellation_reason: 'Cancelled by customer' })
        .eq('id', id);
      onRefresh();
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="w-full p-4 space-y-4">
      <div className="space-y-3">
        <div>
          <h1 className="font-display text-xl font-bold text-[#111111]">My Rides</h1>
          <p className="text-xs text-[#737373]">
            Complete history of your bookings, scheduled trips, and digital receipts.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-neutral-200 rounded-xl overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'all', label: 'All Rides' },
              { id: 'driver_history', label: 'Driver History' },
              { id: 'completed', label: 'Completed' },
              { id: 'cancelled', label: 'Cancelled' },
              { id: 'upcoming', label: 'Upcoming' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition cursor-pointer ${
                tab === t.id
                  ? 'bg-[#111111] text-[#FFC928]'
                  : 'text-[#737373] hover:text-[#111111]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-28 bg-white rounded-2xl border border-neutral-200 animate-pulse" />
          <div className="h-28 bg-white rounded-2xl border border-neutral-200 animate-pulse" />
        </div>
      ) : tab === 'upcoming' ? (
        scheduledRides.length === 0 ? (
          <div className="bg-white rounded-3xl border border-neutral-200 p-8 text-center space-y-2">
            <CalendarClock className="w-8 h-8 text-neutral-300 mx-auto" />
            <p className="text-sm font-semibold text-[#111111]">No upcoming scheduled rides.</p>
            <p className="text-xs text-[#737373]">
              Schedule a future Bike, Auto, or Cab trip from the Home screen.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduledRides.map((sr) => (
              <div
                key={sr.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#111111]">
                    {sr.vehicle_categories?.name || 'Ride'} · {sr.status.replace('_', ' ')}
                  </span>
                  <span className="font-mono-num font-bold text-[#111111]">
                    ₹{Number(sr.estimated_fare).toFixed(0)}
                  </span>
                </div>
                <p className="text-xs font-mono-num text-[#737373]">
                  Pickup: {new Date(sr.scheduled_for).toLocaleString()}
                </p>
                <div className="text-xs space-y-1.5">
                  <p className="truncate text-[#111111] font-medium">From: {sr.pickup_address}</p>
                  <p className="truncate text-[#737373]">To: {sr.drop_address}</p>
                </div>
                {sr.status === 'scheduled' && (
                  <button
                    type="button"
                    disabled={cancellingId === sr.id}
                    onClick={() => handleCancelScheduled(sr.id)}
                    className="w-full min-h-[40px] rounded-xl border border-red-200 text-[#DC2626] text-xs font-semibold hover:bg-red-50 cursor-pointer"
                  >
                    {cancellingId === sr.id ? 'Cancelling...' : 'Cancel Scheduled Ride'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : filteredRides.length === 0 ? (
        <div className="bg-white rounded-3xl border border-neutral-200 p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-[#111111]">No rides found yet.</p>
          <p className="text-xs text-[#737373]">
            Your real completed, active, and cancelled rides will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRides.map((ride) => {
            const drvName = ride.drivers?.users?.full_name || 'Assigned Captain';
            const drvAvatar = ride.drivers?.users?.avatar_url || null;
            const drvPhone = ride.drivers?.users?.phone || '';
            const drvPlate = ride.vehicles?.registration_number || '';
            const drvVehicle = ride.vehicles
              ? `${ride.vehicles.color} ${ride.vehicles.make} ${ride.vehicles.model}`
              : '';

            return (
              <div
                key={ride.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 hover:border-neutral-300 transition space-y-3"
              >
                <button
                  type="button"
                  onClick={() => setSelectedRide(ride)}
                  className="w-full text-left space-y-3 cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-[#737373] flex items-center gap-1.5">
                      <span className="font-mono-num font-bold text-[#111111]">
                        {ride.ride_code}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{ride.vehicle_categories?.name || 'Cab'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(ride.created_at).toLocaleDateString()}</span>
                    </div>
                    <span className="font-mono-num font-bold text-sm text-[#111111]">
                      ₹{Number(ride.total_fare).toFixed(2)}
                    </span>
                  </div>

                  {ride.drivers && (
                    <div className="rounded-xl bg-[#F7F8FA] border border-neutral-200 p-2.5 flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-[#111111] text-[#FFC928] font-display text-xs font-bold flex items-center justify-center shrink-0 overflow-hidden">
                          {drvAvatar ? (
                            <img
                              src={drvAvatar}
                              alt={drvName}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            drvName.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#111111] truncate">{drvName}</p>
                          <p className="text-[11px] text-[#737373] truncate">
                            {drvVehicle || ride.vehicle_categories?.name || 'Verified Vehicle'}
                          </p>
                        </div>
                      </div>
                      {drvPlate && (
                        <span className="font-mono-num text-[11px] font-bold px-2 py-1 rounded-lg bg-white border border-neutral-300 text-[#111111] shrink-0">
                          {drvPlate}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#16A34A] shrink-0" />
                      <span className="truncate text-[#111111] font-medium">
                        {ride.pickup_address}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-sm bg-[#111111] shrink-0" />
                      <span className="truncate text-[#737373]">{ride.drop_address}</span>
                    </div>
                  </div>
                </button>

                <div className="pt-2 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#737373]">
                  <span className="capitalize">
                    {ride.status.replace(/_/g, ' ')} · {ride.payment_method.toUpperCase()}
                  </span>
                  <div className="flex items-center gap-2">
                    {drvPhone && (
                      <a
                        href={`tel:${drvPhone}`}
                        className="min-h-[34px] px-2.5 rounded-lg border border-neutral-200 bg-white text-[#111111] font-semibold inline-flex items-center gap-1 hover:bg-neutral-50"
                      >
                        <Phone className="w-3 h-3 text-[#16A34A]" />
                        <span>Call</span>
                      </a>
                    )}
                    {ride.drivers && onOpenDriverChat && (
                      <button
                        type="button"
                        onClick={() => onOpenDriverChat(ride.id)}
                        className="min-h-[34px] px-2.5 rounded-lg bg-[#FFC928] text-[#111111] font-bold inline-flex items-center gap-1 hover:brightness-95 cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>Chat</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedRide(ride)}
                      className="min-h-[34px] px-2 font-semibold text-[#111111] hover:underline cursor-pointer"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ride Detail Bottom Sheet */}
      {selectedRide && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center">
          <div className="bg-white rounded-t-3xl w-full p-5 pb-safe shadow-2xl border-t border-neutral-200 max-h-[88%] overflow-y-auto space-y-4">
            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-mono-num text-[#737373]">{selectedRide.ride_code}</p>
                <h3 className="font-display text-lg font-bold text-[#111111]">Trip Details</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRide(null)}
                aria-label="Close trip details"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#F7F8FA] p-4 space-y-2 text-xs">
              <p className="text-[#111111] font-medium">
                <strong>Pickup:</strong> {selectedRide.pickup_address}
              </p>
              <p className="text-[#111111] font-medium">
                <strong>Destination:</strong> {selectedRide.drop_address}
              </p>
              <p className="text-[#737373] font-mono-num">
                Distance: {(selectedRide.distance_meters / 1000).toFixed(2)} km · Duration:{' '}
                {Math.max(1, Math.round(selectedRide.duration_seconds / 60))} min
              </p>
            </div>

            {selectedRide.drivers && (
              <div className="rounded-2xl border border-neutral-200 p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-[#111111] text-[#FFC928] font-display text-sm font-bold flex items-center justify-center shrink-0 overflow-hidden">
                      {selectedRide.drivers.users?.avatar_url ? (
                        <img
                          src={selectedRide.drivers.users.avatar_url}
                          alt={selectedRide.drivers.users.full_name || 'Driver'}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (selectedRide.drivers.users?.full_name || 'D').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-[#111111] truncate">
                        {selectedRide.drivers.users?.full_name || 'Driver'}
                      </p>
                      <p className="text-[#737373] truncate">
                        {selectedRide.vehicles
                          ? `${selectedRide.vehicles.color} ${selectedRide.vehicles.make} ${selectedRide.vehicles.model}`
                          : 'Verified Partner'}
                      </p>
                      {selectedRide.drivers.users?.phone && (
                        <p className="font-mono-num text-[11px] font-semibold text-[#111111] mt-0.5">
                          {selectedRide.drivers.users.phone}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <span className="inline-flex items-center gap-1 font-mono-num font-semibold">
                      <Star className="w-3.5 h-3.5 text-[#FFC928] fill-[#FFC928]" />
                      {Number(selectedRide.drivers.rating_avg || 5).toFixed(1)}
                    </span>
                    {selectedRide.vehicles?.registration_number && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#F7F8FA] border border-neutral-300 font-mono-num font-bold text-[11px] text-[#111111]">
                        <Car className="w-3 h-3" />
                        <span>{selectedRide.vehicles.registration_number}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-neutral-100">
                  {selectedRide.drivers.users?.phone && (
                    <a
                      href={`tel:${selectedRide.drivers.users.phone}`}
                      className="flex-1 min-h-[40px] rounded-xl bg-[#16A34A] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-green-700"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Driver</span>
                    </a>
                  )}
                  {onOpenDriverChat && (
                    <button
                      type="button"
                      onClick={() => {
                        const rideId = selectedRide.id;
                        setSelectedRide(null);
                        onOpenDriverChat(rideId);
                      }}
                      className="flex-1 min-h-[40px] rounded-xl bg-[#FFC928] text-[#111111] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:brightness-95 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Open Live Chat</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-neutral-200 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-[#111111] mb-1">
                <Receipt className="w-4 h-4" />
                <span>Fare & Payment Breakdown</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#737373]">Base fare</span>
                <span className="font-mono-num">₹{Number(selectedRide.base_fare).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#737373]">Distance fare</span>
                <span className="font-mono-num">₹{Number(selectedRide.distance_fare).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#737373]">Time & surge</span>
                <span className="font-mono-num">
                  ₹{(Number(selectedRide.time_fare) + Number(selectedRide.surge_fare)).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#737373]">Taxes & platform fee</span>
                <span className="font-mono-num">
                  ₹{(Number(selectedRide.tax_amount) + Number(selectedRide.platform_fee)).toFixed(2)}
                </span>
              </div>
              {Number(selectedRide.discount_amount) > 0 && (
                <div className="flex justify-between text-[#16A34A]">
                  <span>Discount</span>
                  <span className="font-mono-num">
                    -₹{Number(selectedRide.discount_amount).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-neutral-100 font-bold text-sm text-[#111111]">
                <span>Total ({selectedRide.payment_method.toUpperCase()})</span>
                <span className="font-mono-num">₹{Number(selectedRide.total_fare).toFixed(2)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const rideId = selectedRide.id;
                setSelectedRide(null);
                onCreateSupportForRide(rideId);
              }}
              className="w-full min-h-[44px] rounded-xl bg-[#111111] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LifeBuoy className="w-4 h-4 text-[#FFC928]" />
              <span>Need Help With This Ride?</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
