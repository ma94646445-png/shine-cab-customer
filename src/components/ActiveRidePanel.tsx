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
import { SupabaseClient } from '@supabase/supabase-js';
import {
  AppConfig,
  PaymentMethod,
  RideRecord,
  RideStatus,
  RideTrackingPoint,
} from '../types/shinecab';

interface ActiveRidePanelProps {
  ride: RideRecord;
  tracking: RideTrackingPoint | null;
  accessToken: string;
  config: AppConfig;
  supabase: SupabaseClient | null;
  onRideUpdated: (ride: RideRecord) => void;
  onTriggerSos: () => void;
  onOpenChat?: () => void;
  onClearCompleted: () => void;
}

const STATUS_LABELS: Record<RideStatus, { title: string; subtitle: string }> = {
  searching_driver: {
    title: 'Searching for a driver',
    subtitle: 'Broadcasting your request to nearby verified drivers.',
  },
  driver_assigned: {
    title: 'Driver assigned',
    subtitle: 'Your driver has accepted the ride and is preparing to depart.',
  },
  driver_arriving: {
    title: 'Driver arriving',
    subtitle: 'Track live driver GPS position on the map.',
  },
  driver_reached_pickup: {
    title: 'Driver reached pickup',
    subtitle: 'Share your 4-digit ride OTP with the driver to begin.',
  },
  otp_verification: {
    title: 'OTP verification',
    subtitle: 'Confirm your 4-digit ride OTP to start the trip.',
  },
  ride_started: {
    title: 'Ride in progress',
    subtitle: 'You are on your way to your destination.',
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
    subtitle: 'Currently no drivers available for this request.',
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
  accessToken,
  config,
  supabase,
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

  // Rating state
  const [overallRating, setOverallRating] = useState(5);
  const [behaviorRating, setBehaviorRating] = useState(5);
  const [cleanlinessRating, setCleanlinessRating] = useState(5);
  const [experienceRating, setExperienceRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(
    Boolean(ride.ratings && ride.ratings.length > 0)
  );

  const statusMeta = STATUS_LABELS[ride.status];
  const canCancel = [
    'searching_driver',
    'driver_assigned',
    'driver_arriving',
    'driver_reached_pickup',
    'otp_verification',
  ].includes(ride.status);

  const needsPayment =
    (ride.status === 'ride_completed' || ride.status === 'payment_pending') &&
    ride.payment_status !== 'paid';

  const handleCancelRide = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rides/${ride.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to cancel ride.');
        return;
      }
      setShowCancelModal(false);
      onRideUpdated({ ...ride, ...data.ride });
    } catch {
      setError('Network error while cancelling ride.');
    } finally {
      setBusy(false);
    }
  };

  const handleShareTrip = async () => {
    const shareUrl = `${window.location.origin}/?share=${ride.share_token}`;
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
      // user cancelled native share
    }
  };

  const handlePayNow = async (method: PaymentMethod) => {
    setBusy(true);
    setError(null);
    try {
      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ rideId: ride.id, paymentMethod: method }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        setError(orderData.error || 'Unable to initialize payment.');
        return;
      }

      if (method === 'cash') {
        onRideUpdated({ ...ride, payment_method: 'cash', payment_status: 'pending_collection' });
        return;
      }

      const RazorpayCtor = (window as unknown as { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } }).Razorpay;
      if (!RazorpayCtor || !config.services.razorpay || !orderData.order?.id) {
        setError('Service configuration required. Please contact support.');
        return;
      }

      const rzp = new RazorpayCtor({
        key: orderData.razorpayKeyId,
        amount: orderData.order.amount,
        currency: orderData.order.currency || 'INR',
        name: 'SHINE CAB',
        description: `Ride ${ride.ride_code}`,
        order_id: orderData.order.id,
        theme: { color: '#FFC928' },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok && verifyData.verified) {
            onRideUpdated({
              ...ride,
              payment_status: 'paid',
              status: 'payment_completed',
            });
          } else {
            setError(verifyData.error || 'Payment signature verification failed.');
          }
        },
      });
      rzp.open();
    } catch {
      setError('Payment initiation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !ride.driver_id) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rateErr } = await supabase.from('ratings').insert({
        ride_id: ride.id,
        customer_id: ride.customer_id,
        driver_id: ride.driver_id,
        overall_rating: overallRating,
        driver_behavior_rating: behaviorRating,
        vehicle_cleanliness_rating: cleanlinessRating,
        experience_rating: experienceRating,
        feedback: feedback.trim() || null,
      });
      if (rateErr) {
        setError(rateErr.message);
        return;
      }
      setRatingSubmitted(true);
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
      {ride.status === 'searching_driver' && (
        <div className="rounded-2xl bg-[#F7F8FA] border border-neutral-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-[#111111] animate-spin shrink-0" />
            <div className="text-xs text-neutral-700">
              Waiting for an approved online driver to accept this request. No simulated drivers are ever injected.
            </div>
          </div>
          <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
            <div className="h-full bg-[#FFC928] w-1/2 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full" />
          </div>
        </div>
      )}

      {/* Ride Start OTP Banner */}
      {['driver_assigned', 'driver_arriving', 'driver_reached_pickup', 'otp_verification'].includes(
        ride.status
      ) && (
        <div className="rounded-2xl bg-[#111111] text-white p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-[#FFC928] shrink-0" />
            <div>
              <p className="text-xs text-neutral-400">Ride Start OTP</p>
              <p className="text-xs text-neutral-300">Share with driver at pickup</p>
            </div>
          </div>
          <div className="font-mono-num text-2xl font-bold tracking-[0.2em] text-[#FFC928]">
            {ride.ride_otp}
          </div>
        </div>
      )}

      {/* Driver & Vehicle Details */}
      {ride.drivers && ride.vehicles && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-full bg-neutral-900 text-[#FFC928] font-display font-bold flex items-center justify-center shrink-0 overflow-hidden">
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
                  {ride.drivers.users?.full_name || 'Assigned Driver'}
                </p>
                <div className="text-xs text-[#737373] flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-[#FFC928] fill-[#FFC928]" />
                  <span className="font-mono-num font-medium text-[#111111]">
                    {Number(ride.drivers.rating_avg || 5).toFixed(1)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">
                    {ride.vehicles.color} {ride.vehicles.make} {ride.vehicles.model}
                  </span>
                </div>
                {ride.drivers.users?.phone && (
                  <p className="text-[11px] font-mono-num font-semibold text-[#111111] mt-0.5">
                    {ride.drivers.users.phone}
                  </p>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className="font-mono-num text-xs font-bold bg-[#F7F8FA] border border-neutral-200 px-2.5 py-1 rounded-lg text-[#111111]">
                {ride.vehicles.registration_number}
              </p>
              {tracking?.eta_seconds != null && (
                <p className="text-[11px] text-[#16A34A] font-semibold mt-1 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span className="font-mono-num">{Math.max(1, Math.round(tracking.eta_seconds / 60))} min</span>
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
                className="min-h-[44px] rounded-xl bg-[#FFC928] text-xs font-semibold text-[#111111] flex items-center justify-center gap-1.5 hover:brightness-95 cursor-pointer"
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
            ₹{Number(ride.total_fare).toFixed(2)}
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
              className="min-h-[44px] rounded-xl bg-[#FFC928] text-[#111111] text-xs font-semibold flex items-center justify-center gap-1.5 hover:brightness-95 cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              <span>Pay Online / UPI</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePayNow('cash')}
              className="min-h-[44px] rounded-xl border border-neutral-300 text-[#111111] text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-neutral-50 cursor-pointer"
            >
              <Banknote className="w-4 h-4" />
              <span>Confirm Cash</span>
            </button>
          </div>
        </div>
      )}

      {/* Post-Ride Rating */}
      {['ride_completed', 'payment_completed'].includes(ride.status) &&
        ride.driver_id &&
        !ratingSubmitted && (
          <form onSubmit={handleSubmitRating} className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
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
                      n <= overallRating ? 'text-[#FFC928] fill-[#FFC928]' : 'text-neutral-300'
                    }`}
                  />
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <label className="space-y-1">
                <span className="text-[#737373]">Behavior</span>
                <select
                  value={behaviorRating}
                  onChange={(e) => setBehaviorRating(Number(e.target.value))}
                  className="w-full h-9 rounded-lg border border-neutral-200 px-2"
                >
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>
                      {v} / 5
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[#737373]">Cleanliness</span>
                <select
                  value={cleanlinessRating}
                  onChange={(e) => setCleanlinessRating(Number(e.target.value))}
                  className="w-full h-9 rounded-lg border border-neutral-200 px-2"
                >
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>
                      {v} / 5
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[#737373]">Experience</span>
                <select
                  value={experienceRating}
                  onChange={(e) => setExperienceRating(Number(e.target.value))}
                  className="w-full h-9 rounded-lg border border-neutral-200 px-2"
                >
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>
                      {v} / 5
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              rows={2}
              placeholder="Share optional feedback about your ride..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
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
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-[#DC2626] font-medium">
          {error}
        </div>
      )}

      {/* Bottom Action */}
      {canCancel && (
        <button
          type="button"
          onClick={() => setShowCancelModal(true)}
          className="w-full min-h-[44px] rounded-xl border border-red-200 text-[#DC2626] text-xs font-semibold hover:bg-red-50 transition cursor-pointer"
        >
          Cancel Ride
        </button>
      )}

      {['payment_completed', 'cancelled', 'failed'].includes(ride.status) && (
        <button
          type="button"
          onClick={onClearCompleted}
          className="w-full min-h-[48px] rounded-2xl bg-[#FFC928] text-[#111111] text-sm font-semibold hover:brightness-95 cursor-pointer"
        >
          Book Another Ride
        </button>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center">
          <div className="bg-white rounded-t-3xl w-full p-5 pb-safe space-y-4 shadow-xl border-t border-neutral-200 max-h-[85%] overflow-y-auto">
            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto" />
            <div className="flex items-center gap-2 text-[#DC2626]">
              <XCircle className="w-5 h-5" />
              <h4 className="font-display text-base font-bold text-[#111111]">Cancel Ride?</h4>
            </div>
            <p className="text-xs text-[#737373]">
              Select a reason. Cancellation after driver arrival may incur a backend cancellation fee.
            </p>
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
