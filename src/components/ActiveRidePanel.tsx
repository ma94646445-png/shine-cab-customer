import React, { useState } from 'react';
import {
  Phone,
  Share2,
  ShieldAlert,
  Star,
  CheckCircle2,
  XCircle,
  CreditCard,
  Banknote,
  RefreshCw,
  Clock,
  KeyRound,
  MessageSquare,
} from 'lucide-react';
import { addDoc, collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  PaymentMethod,
  RideRecord,
  RideStatus,
  RideTrackingPoint,
} from '../types/shinecab';

interface ActiveRidePanelProps {
  ride: RideRecord;
  tracking: RideTrackingPoint | null;
  customerUid: string;
  onRideUpdated: (ride: RideRecord) => void;
  onTriggerSos: () => void;
  onOpenChat?: () => void;
  onClearCompleted: () => void;
}

const STATUS_LABELS: Record<RideStatus, { title: string; subtitle: string }> = {
  searching: {
    title: 'Searching for a driver',
    subtitle: 'Broadcasting your request to nearby verified captains.',
  },
  searching_driver: {
    title: 'Searching for a driver',
    subtitle: 'Broadcasting your request to nearby verified captains.',
  },
  driver_assigned: {
    title: 'Driver assigned',
    subtitle: 'Your captain has accepted the ride and is heading to pickup.',
  },
  arrived: {
    title: 'Driver arrived at pickup',
    subtitle: 'Share your 4-digit ride OTP with the captain to begin.',
  },
  driver_arriving: {
    title: 'Driver arriving',
    subtitle: 'Track live driver GPS position on the map.',
  },
  driver_reached_pickup: {
    title: 'Driver reached pickup',
    subtitle: 'Share your 4-digit ride OTP with the captain to begin.',
  },
  otp_verification: {
    title: 'OTP verification',
    subtitle: 'Confirm your 4-digit ride OTP to start the trip.',
  },
  in_progress: {
    title: 'Ride in progress',
    subtitle: 'You are on your way to your destination.',
  },
  ride_started: {
    title: 'Ride in progress',
    subtitle: 'You are on your way to your destination.',
  },
  completed: {
    title: 'Ride completed',
    subtitle: 'Confirm payment to receive your digital receipt.',
  },
  ride_completed: {
    title: 'Ride completed',
    subtitle: 'Confirm payment to receive your digital receipt.',
  },
  payment_pending: {
    title: 'Payment pending',
    subtitle: 'Complete payment to close your trip.',
  },
  payment_completed: {
    title: 'Payment completed',
    subtitle: 'Thank you for riding with SHINE CAB.',
  },
  cancelled: {
    title: 'Ride cancelled',
    subtitle: 'This booking has been cancelled.',
  },
  failed: {
    title: 'Driver search unsuccessful',
    subtitle: 'Currently no captains available for this request.',
  },
};

const CANCEL_REASONS = [
  'Driver is taking too long',
  'Changed my plans',
  'Booked by mistake',
  'Driver asked to cancel',
  'Pickup location changed',
];

export const ActiveRidePanel: React.FC<ActiveRidePanelProps> = ({
  ride,
  tracking,
  customerUid,
  onRideUpdated,
  onTriggerSos,
  onOpenChat,
  onClearCompleted,
}) => {
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const [overallRating, setOverallRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(
    Boolean(ride.ratings && ride.ratings.length > 0)
  );

  const statusMeta = STATUS_LABELS[ride.status] || STATUS_LABELS.searching;
  const canCancel = [
    'searching',
    'searching_driver',
    'driver_assigned',
    'arrived',
    'driver_arriving',
    'driver_reached_pickup',
    'otp_verification',
  ].includes(ride.status);

  const isCompletedState = [
    'completed',
    'ride_completed',
    'payment_pending',
    'payment_completed',
  ].includes(ride.status);

  const needsPayment = isCompletedState && ride.payment_status !== 'paid';

  const handleCancelRide = async () => {
    setBusy(true);
    setError(null);
    const nowIso = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'rides', ride.id), {
        status: 'cancelled',
        cancellation_reason: cancelReason,
        cancelled_at: nowIso,
        updated_at: nowIso,
      });
      setShowCancelModal(false);
      onRideUpdated({
        ...ride,
        status: 'cancelled',
        cancellation_reason: cancelReason,
        cancelled_at: nowIso,
      });
    } catch (err) {
      setError('Unable to cancel ride right now.');
      try {
        handleFirestoreError(err, OperationType.UPDATE, `rides/${ride.id}`);
      } catch {
        // logged
      }
    } finally {
      setBusy(false);
    }
  };

  const handleShareTrip = async () => {
    const shareUrl = `${window.location.origin}/?share=${ride.share_token}`;
    try {
      await setDoc(
        doc(db, 'shared_trips', ride.share_token),
        {
          id: ride.id,
          customer_uid: customerUid,
          ride_code: ride.ride_code,
          status: ride.status,
          pickup_address: ride.pickup_address,
          pickup_lat: ride.pickup_lat,
          pickup_lng: ride.pickup_lng,
          drop_address: ride.drop_address,
          drop_lat: ride.drop_lat,
          drop_lng: ride.drop_lng,
          driver_name: ride.drivers?.users?.full_name || null,
          driver_lat: tracking?.lat ?? ride.drivers?.current_lat ?? null,
          driver_lng: tracking?.lng ?? ride.drivers?.current_lng ?? null,
          vehicle_label: ride.vehicles
            ? `${ride.vehicles.color} ${ride.vehicles.make} ${ride.vehicles.model}`
            : ride.vehicle_categories?.name || null,
          registration_number: ride.vehicles?.registration_number || null,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch {
      // non-fatal if share link sync fails offline
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: `SHINE CAB Trip ${ride.ride_code}`,
          text: `Track my SHINE CAB trip from ${ride.pickup_address} to ${ride.drop_address}`,
          url: shareUrl,
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setShareFeedback('Live trip link copied to clipboard.');
        setTimeout(() => setShareFeedback(null), 3000);
      }
    } catch {
      // user cancelled share
    }
  };

  const handlePayNow = async (method: PaymentMethod) => {
    setBusy(true);
    setError(null);
    const nowIso = new Date().toISOString();
    try {
      const nextStatus: RideStatus = method === 'cash' ? ride.status : 'payment_completed';
      const nextPaymentStatus = method === 'cash' ? 'pending_collection' : 'paid';

      await updateDoc(doc(db, 'rides', ride.id), {
        payment_method: method,
        payment_status: nextPaymentStatus,
        status: nextStatus,
        updated_at: nowIso,
      });

      await addDoc(collection(db, 'payments'), {
        customer_uid: customerUid,
        ride_id: ride.id,
        amount: Number(ride.total_fare || 0),
        currency: 'INR',
        payment_method: method,
        provider: method === 'cash' ? 'cash' : 'upi',
        status: nextPaymentStatus === 'paid' ? 'captured' : 'pending_collection',
        receipt_number: `RCPT-${ride.ride_code.replace('RIDE-', '')}`,
        paid_at: nextPaymentStatus === 'paid' ? nowIso : null,
        created_at: nowIso,
      });

      onRideUpdated({
        ...ride,
        payment_method: method,
        payment_status: nextPaymentStatus,
        status: nextStatus,
      });
    } catch (err) {
      setError('Unable to update payment right now.');
      try {
        handleFirestoreError(err, OperationType.WRITE, `payments`);
      } catch {
        // logged
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ratingEntry = {
        id: `rat-${Date.now()}`,
        overall_rating: overallRating,
        feedback: feedback.trim() || null,
        created_at: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'rides', ride.id), {
        ratings: [ratingEntry],
        updated_at: new Date().toISOString(),
      });
      setRatingSubmitted(true);
    } catch {
      setError('Unable to save rating.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-[#737373] flex items-center gap-2">
            <span className="font-mono-num font-semibold text-[#111111]">{ride.ride_code}</span>
            <span aria-hidden="true">·</span>
            <span>{ride.vehicle_categories?.name || 'Ride'}</span>
          </div>
          <h3 className="font-display text-lg font-bold text-[#111111] mt-0.5">
            {statusMeta.title}
          </h3>
          <p className="text-xs text-[#737373]">{statusMeta.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={onTriggerSos}
          className="min-h-[44px] px-3 rounded-xl bg-[#DC2626] text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-red-700 shrink-0 cursor-pointer"
        >
          <ShieldAlert className="w-4 h-4" />
          <span>SOS</span>
        </button>
      </div>

      {/* Searching Driver State */}
      {(ride.status === 'searching' || ride.status === 'searching_driver') && (
        <div className="rounded-2xl bg-[#F7F8FA] border border-neutral-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-[#111111] animate-spin shrink-0" />
            <div className="text-xs text-neutral-700">
              Connecting with nearby verified SHINE CAB captains. Live updates appear automatically.
            </div>
          </div>
          <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
            <div className="h-full bg-[#F5C518] w-1/2 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full" />
          </div>
        </div>
      )}

      {/* Ride Start OTP Banner */}
      {[
        'searching',
        'searching_driver',
        'driver_assigned',
        'arrived',
        'driver_arriving',
        'driver_reached_pickup',
        'otp_verification',
      ].includes(ride.status) && (
        <div className="rounded-2xl bg-[#1E1E1E] text-white p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-[#F5C518] shrink-0" />
            <div>
              <p className="text-xs text-neutral-400">Ride Start OTP</p>
              <p className="text-xs text-neutral-300">Share with captain at pickup</p>
            </div>
          </div>
          <div className="font-mono-num text-2xl font-bold tracking-[0.2em] text-[#F5C518]">
            {ride.ride_otp}
          </div>
        </div>
      )}

      {/* Driver & Vehicle Details */}
      {ride.drivers && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-full bg-neutral-900 text-[#F5C518] font-display font-bold flex items-center justify-center shrink-0 overflow-hidden">
                {ride.drivers.users?.avatar_url ? (
                  <img
                    src={ride.drivers.users.avatar_url}
                    alt={ride.drivers.users.full_name || 'Driver'}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (ride.drivers.users?.full_name || 'D').charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-[#111111] truncate">
                  {ride.drivers.users?.full_name || 'Assigned Captain'}
                </p>
                <div className="text-xs text-[#737373] flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-[#F5C518] fill-[#F5C518]" />
                  <span className="font-mono-num font-medium text-[#111111]">
                    {Number(ride.drivers.rating_avg || 5).toFixed(1)}
                  </span>
                  {ride.vehicles && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">
                        {ride.vehicles.color} {ride.vehicles.make} {ride.vehicles.model}
                      </span>
                    </>
                  )}
                </div>
                {ride.drivers.users?.phone && (
                  <p className="text-[11px] font-mono-num font-semibold text-[#111111] mt-0.5">
                    {ride.drivers.users.phone}
                  </p>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              {ride.vehicles?.registration_number && (
                <p className="font-mono-num text-xs font-bold bg-[#F7F8FA] border border-neutral-200 px-2.5 py-1 rounded-lg text-[#111111]">
                  {ride.vehicles.registration_number}
                </p>
              )}
              {tracking?.eta_seconds != null && (
                <p className="text-[11px] text-[#16A34A] font-semibold mt-1 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="font-mono-num">
                    {Math.max(1, Math.round(tracking.eta_seconds / 60))} min
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-neutral-100">
            {ride.drivers.users?.phone && (
              <a
                href={`tel:${ride.drivers.users.phone}`}
                className="min-h-[44px] rounded-xl border border-neutral-200 text-xs font-semibold text-[#111111] flex items-center justify-center gap-1.5 hover:bg-neutral-50"
              >
                <Phone className="w-4 h-4" />
                <span>Call</span>
              </a>
            )}
            {onOpenChat && (
              <button
                type="button"
                onClick={onOpenChat}
                className="min-h-[44px] rounded-xl bg-[#F5C518] text-xs font-semibold text-[#111111] flex items-center justify-center gap-1.5 hover:brightness-95 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Chat</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleShareTrip}
              className="min-h-[44px] rounded-xl border border-neutral-200 text-xs font-semibold text-[#111111] flex items-center justify-center gap-1.5 hover:bg-neutral-50 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>Share</span>
            </button>
          </div>
          {shareFeedback && <p className="text-xs text-[#16A34A] font-medium">{shareFeedback}</p>}
        </div>
      )}

      {/* Route & Fare Summary */}
      <div className="rounded-2xl bg-[#F7F8FA] border border-neutral-200 p-4 space-y-2.5 text-xs">
        <div className="flex items-start gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A] mt-1 shrink-0" />
          <span className="text-neutral-800 font-medium line-clamp-2">{ride.pickup_address}</span>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#111111] mt-1 shrink-0" />
          <span className="text-neutral-800 font-medium line-clamp-2">{ride.drop_address}</span>
        </div>
        <div className="pt-2 border-t border-neutral-200 flex items-center justify-between">
          <span className="text-[#737373]">
            Fare ({ride.payment_method.toUpperCase()} · {ride.payment_status.replace('_', ' ')})
          </span>
          <span className="font-mono-num text-base font-bold text-[#111111]">
            ₹{Number(ride.total_fare).toFixed(0)}
          </span>
        </div>
      </div>

      {/* Payment Settlement Actions */}
      {needsPayment && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-[#111111]">Complete Trip Payment</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePayNow('upi')}
              className="min-h-[44px] rounded-xl bg-[#F5C518] text-[#111111] text-xs font-semibold flex items-center justify-center gap-1.5 hover:brightness-95 cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              <span>Mark UPI Paid</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePayNow('cash')}
              className="min-h-[44px] rounded-xl border border-neutral-300 text-[#111111] text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-neutral-50 cursor-pointer"
            >
              <Banknote className="w-4 h-4" />
              <span>Pay Cash</span>
            </button>
          </div>
        </div>
      )}

      {/* Post-Ride Rating */}
      {isCompletedState && !ratingSubmitted && (
        <form
          onSubmit={handleSubmitRating}
          className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3"
        >
          <p className="font-display text-sm font-bold text-[#111111]">Rate your ride</p>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setOverallRating(n)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl hover:bg-neutral-50 cursor-pointer"
                aria-label={`Rate ${n} stars`}
              >
                <Star
                  className={`w-6 h-6 ${
                    n <= overallRating ? 'text-[#F5C518] fill-[#F5C518]' : 'text-neutral-300'
                  }`}
                />
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            placeholder="Share optional feedback about your ride..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="w-full rounded-xl border border-neutral-200 p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[44px] rounded-xl bg-[#111111] text-white text-xs font-semibold cursor-pointer"
          >
            Submit Review
          </button>
        </form>
      )}

      {ratingSubmitted && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-[#16A34A] font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Thank you! Your review has been saved.</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-[#DC2626] font-medium"
        >
          {error}
        </div>
      )}

      {canCancel && (
        <button
          type="button"
          onClick={() => setShowCancelModal(true)}
          className="w-full min-h-[44px] rounded-xl border border-red-200 text-[#DC2626] text-xs font-semibold hover:bg-red-50 transition cursor-pointer"
        >
          Cancel Ride
        </button>
      )}

      {['payment_completed', 'completed', 'ride_completed', 'cancelled', 'failed'].includes(
        ride.status
      ) && (
        <button
          type="button"
          onClick={onClearCompleted}
          className="w-full min-h-[48px] rounded-2xl bg-[#F5C518] text-[#111111] text-sm font-bold hover:brightness-95 cursor-pointer"
        >
          Book Another Ride
        </button>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-end justify-center">
          <div className="bg-white rounded-t-3xl w-full p-5 pb-[max(env(safe-area-inset-bottom),16px)] space-y-4 shadow-xl border-t border-neutral-200 max-h-[85%] overflow-y-auto">
            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto" />
            <div className="flex items-center gap-2 text-[#DC2626]">
              <XCircle className="w-5 h-5" />
              <h4 className="font-display text-base font-bold text-[#111111]">Cancel Ride?</h4>
            </div>
            <p className="text-xs text-[#737373]">Select a reason to cancel this booking.</p>
            <div className="space-y-2">
              {CANCEL_REASONS.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-2.5 text-xs text-[#111111] p-2.5 rounded-xl border border-neutral-200 cursor-pointer hover:bg-neutral-50"
                >
                  <input
                    type="radio"
                    name="cancelReason"
                    checked={cancelReason === r}
                    onChange={() => setCancelReason(r)}
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="min-h-[44px] rounded-xl border border-neutral-200 text-xs font-semibold text-[#111111] cursor-pointer"
              >
                Keep Ride
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleCancelRide}
                className="min-h-[44px] rounded-xl bg-[#DC2626] text-white text-xs font-semibold cursor-pointer"
              >
                {busy ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
