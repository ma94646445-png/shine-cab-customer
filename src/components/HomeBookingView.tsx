import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MapPin,
  Search,
  Home,
  Briefcase,
  CalendarClock,
  Tag,
  ShieldAlert,
  ShieldCheck,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Clock,
  Navigation,
  Bike,
  Car,
  ArrowUpDown,
  Share2,
  Info,
  X,
  UserCheck,
  Compass,
  Receipt,
  Radar,
  Phone,
  Star,
} from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildFareEstimates,
  computeHaversineMeters,
  normalizeSlug,
  RawFareConfig,
  reverseGeocodeNominatim,
} from '../lib/osm';
import {
  Coupon,
  FareEstimate,
  LocationPoint,
  NearbyDriverDetail,
  PaymentMethod,
  RideRecord,
  RideTrackingPoint,
  SavedAddress,
  UserProfile,
  VehicleSlug,
} from '../types/shinecab';
import { RideMapCanvas, RouteComputedResult, NearbyDriverMarker } from './RideMapCanvas';
import { LocationSearchModal } from './LocationSearchModal';
import { ActiveRidePanel } from './ActiveRidePanel';
import { useNearbyLandmarks } from '../hooks/useNearbyLandmarks';

const VEHICLE_IMAGES: Record<VehicleSlug, string> = {
  bike: '/src/assets/images/shine_cab_bike_1795183470047.jpg',
  auto: '/src/assets/images/shine_cab_auto_1795183470393.jpg',
  cab: '/src/assets/images/shine_cab_cab_1795183469304.jpg',
};

const SERVICE_DESCRIPTIONS: Record<
  VehicleSlug,
  { title: string; subtitle: string; seats: string }
> = {
  bike: { title: 'Bike', subtitle: 'Quick solo rides', seats: '1 seat' },
  auto: { title: 'Auto', subtitle: 'Doorstep city travel', seats: '3 seats' },
  cab: { title: 'Cab', subtitle: 'AC comfort rides', seats: '4 seats' },
};

interface HomeBookingViewProps {
  googleMapsApiKey?: string;
  customerUid: string;
  userProfile: UserProfile | null;
  savedAddresses: SavedAddress[];
  recentDestinations: LocationPoint[];
  coupons: Coupon[];
  activeRide: RideRecord | null;
  tracking: RideTrackingPoint | null;
  onRideCreated: (ride: RideRecord) => void;
  onRideUpdated: (ride: RideRecord | null) => void;
  onTriggerSos: () => void;
  onOpenChat?: () => void;
  onNavigateTab: (tab: 'rides' | 'offers' | 'support' | 'profile') => void;
  preAppliedCouponCode?: string | null;
}

export const HomeBookingView: React.FC<HomeBookingViewProps> = ({
  googleMapsApiKey,
  customerUid,
  userProfile,
  savedAddresses,
  recentDestinations,
  coupons,
  activeRide,
  tracking,
  onRideCreated,
  onRideUpdated,
  onTriggerSos,
  onOpenChat,
  onNavigateTab,
  preAppliedCouponCode,
}) => {
  const [pickup, setPickup] = useState<LocationPoint | null>(null);
  const [drop, setDrop] = useState<LocationPoint | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [liveSpeedKmh, setLiveSpeedKmh] = useState<number>(0);
  const [searchModalMode, setSearchModalMode] = useState<'pickup' | 'drop' | null>(null);
  const [pinSelectMode, setPinSelectMode] = useState<'pickup' | 'drop' | null>(null);
  const [routeMetrics, setRouteMetrics] = useState<RouteComputedResult | null>(null);
  const [mapExpandedOnMobile, setMapExpandedOnMobile] = useState(false);

  const [fareConfigs, setFareConfigs] = useState<RawFareConfig[]>([]);
  const [rawDrivers, setRawDrivers] = useState<any[]>([]);
  const [searchRadiusKm, setSearchRadiusKm] = useState<number>(5);
  const [showSearchRadius, setShowSearchRadius] = useState<boolean>(false);
  const [nearbySearched, setNearbySearched] = useState<boolean>(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<VehicleSlug>('bike');
  const [showFareBreakup, setShowFareBreakup] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');

  const [rideFor, setRideFor] = useState<'myself' | 'someone_else'>('myself');
  const [guestRiderName, setGuestRiderName] = useState('');
  const [guestRiderPhone, setGuestRiderPhone] = useState('');

  const [promoInput, setPromoInput] = useState(preAppliedCouponCode || '');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleFeedback, setScheduleFeedback] = useState<string | null>(null);

  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});

  const { landmarks: nearbyLandmarks, loading: landmarksLoading } = useNearbyLandmarks(
    pickup ? { lat: pickup.lat, lng: pickup.lng } : null,
    Boolean(pickup && !drop && !activeRide)
  );

  // Real-time Firestore listener for admin-configured fare_configs
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'fare_configs'),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, any>),
        })) as RawFareConfig[];
        setFareConfigs(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, 'fare_configs');
        } catch {
          // logged
        }
      }
    );
    return () => unsub();
  }, []);

  // Real-time Firestore listener for online drivers
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'drivers'),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, any>),
        }));
        setRawDrivers(list);
      },
      () => {
        // non-blocking fallback if drivers collection is empty/restricted
      }
    );
    return () => unsub();
  }, []);

  // Sync preAppliedCouponCode with active Firestore coupons
  useEffect(() => {
    if (preAppliedCouponCode) {
      setPromoInput(preAppliedCouponCode);
      const found = coupons.find(
        (c) => c.code.toUpperCase() === preAppliedCouponCode.trim().toUpperCase()
      );
      if (found) {
        setAppliedCoupon(found);
        setCouponError(null);
      }
    }
  }, [preAppliedCouponCode, coupons]);

  // Live GPS Speedometer watcher (km/h)
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const kmh = Math.round((pos.coords.speed || 0) * 3.6);
        setLiveSpeedKmh(Number.isFinite(kmh) && kmh >= 0 ? kmh : 0);
      },
      () => {
        // silent if background watch blocked
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const requestCurrentGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGpsDenied(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const kmh = Math.round((pos.coords.speed || 0) * 3.6);
        setLiveSpeedKmh(Number.isFinite(kmh) && kmh >= 0 ? kmh : 0);
        const address = await reverseGeocodeNominatim(lat, lng);
        setPickup({ address, lat, lng });
      },
      () => {
        setGpsDenied(true);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    if (!activeRide && !pickup) {
      requestCurrentGps();
    }
  }, [activeRide, pickup, requestCurrentGps]);

  // Nearby online drivers computed from Firestore drivers collection
  const nearbyDriversList: NearbyDriverDetail[] = useMemo(() => {
    const center = pickup;
    return rawDrivers
      .filter((d) => {
        const isOnline = d.is_online ?? d.online ?? true;
        const lat = Number(d.current_lat ?? d.lat);
        const lng = Number(d.current_lng ?? d.lng);
        return Boolean(isOnline) && Number.isFinite(lat) && Number.isFinite(lng);
      })
      .map((d) => {
        const lat = Number(d.current_lat ?? d.lat);
        const lng = Number(d.current_lng ?? d.lng);
        const slug: VehicleSlug =
          normalizeSlug(d.vehicle_category || d.slug || d.category) || 'cab';
        const distM = center ? computeHaversineMeters(center, { lat, lng }) : 1500;
        const distKm = Number((distM / 1000).toFixed(1));
        return {
          id: d.id,
          userId: d.user_id || d.uid || d.id,
          name: d.name || d.full_name || 'SHINE CAB Captain',
          avatarUrl: d.avatar_url || null,
          phone: d.phone || '',
          ratingAvg: Number(d.rating_avg || 5.0),
          categoryId: slug,
          categoryName: SERVICE_DESCRIPTIONS[slug].title,
          slug,
          vehicle: {
            id: d.vehicle_id || d.id,
            make: d.vehicle_make || '',
            model: d.vehicle_model || SERVICE_DESCRIPTIONS[slug].title,
            color: d.vehicle_color || '',
            registrationNumber: d.registration_number || d.vehicle_number || 'Verified',
          },
          lat,
          lng,
          heading: Number(d.current_heading || 0),
          distanceKm: distKm,
          etaMinutes: Math.max(2, Math.round(distKm * 2.5)),
        };
      })
      .filter((d) => !center || d.distanceKm <= searchRadiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [rawDrivers, pickup?.lat, pickup?.lng, searchRadiusKm]);

  const nearbyDriversMarkers: NearbyDriverMarker[] = useMemo(
    () =>
      nearbyDriversList.map((d) => ({
        id: d.id,
        slug: d.slug,
        lat: d.lat,
        lng: d.lng,
        heading: d.heading,
      })),
    [nearbyDriversList]
  );

  const nearbyCounts = useMemo(() => {
    const counts: Record<VehicleSlug, number> = { bike: 0, auto: 0, cab: 0 };
    nearbyDriversList.forEach((d) => {
      counts[d.slug] = (counts[d.slug] || 0) + 1;
    });
    return counts;
  }, [nearbyDriversList]);

  const handleMapSelectPoint = async (lat: number, lng: number) => {
    if (!pinSelectMode) return;
    const address = await reverseGeocodeNominatim(lat, lng);
    const point: LocationPoint = { address, lat, lng };
    if (pinSelectMode === 'pickup') {
      setPickup(point);
    } else {
      setDrop(point);
      setMapExpandedOnMobile(false);
    }
    setPinSelectMode(null);
  };

  const handleSwapLocations = () => {
    if (!pickup && !drop) return;
    const prevPickup = pickup;
    const prevDrop = drop;
    setPickup(prevDrop);
    setDrop(prevPickup);
    setRouteMetrics(null);
  };

  const displayRouteMetrics: RouteComputedResult | null = useMemo(() => {
    if (routeMetrics) return routeMetrics;
    if (!pickup || !drop) return null;
    const straight = Math.max(200, computeHaversineMeters(pickup, drop));
    const roadMeters = Math.round(straight * 1.25);
    const dur = Math.max(120, Math.round((roadMeters / 1000 / 26) * 3600));
    return { distanceMeters: roadMeters, durationSeconds: dur, isApproximate: true };
  }, [routeMetrics, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  // Compute minimum estimates for category preview cards & live route estimates
  const categoryPreviewEstimates = useMemo(
    () => buildFareEstimates(fareConfigs, 1000, 180, nearbyCounts, null),
    [fareConfigs, nearbyCounts]
  );

  const estimates: FareEstimate[] = useMemo(() => {
    if (!displayRouteMetrics || !pickup || !drop) return [];
    return buildFareEstimates(
      fareConfigs,
      displayRouteMetrics.distanceMeters,
      displayRouteMetrics.durationSeconds,
      nearbyCounts,
      appliedCoupon
    );
  }, [fareConfigs, displayRouteMetrics, pickup, drop, nearbyCounts, appliedCoupon]);

  const selectedEstimate = estimates.find((e) => e.slug === selectedSlug) || estimates[0] || null;

  const handleApplyPromoCode = () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) {
      setAppliedCoupon(null);
      setCouponError(null);
      return;
    }
    const found = coupons.find((c) => c.code.toUpperCase() === code);
    if (!found) {
      setAppliedCoupon(null);
      setCouponError('Invalid or expired promo code.');
      return;
    }
    setAppliedCoupon(found);
    setCouponError(null);
  };

  const handleConfirmBooking = async () => {
    if (!pickup || !drop) {
      setBookingError('Please select both pickup and drop locations.');
      return;
    }
    if (!selectedEstimate || !displayRouteMetrics) {
      setBookingError('Calculating route fare. Please wait a moment.');
      return;
    }
    if (rideFor === 'someone_else' && (!guestRiderName.trim() || guestRiderPhone.trim().length < 8)) {
      setBookingError('Enter the passenger name and valid mobile number.');
      return;
    }

    setBookingLoading(true);
    setBookingError(null);

    try {
      const rideRef = doc(collection(db, 'rides'));
      const rideCode = `RIDE-${Math.floor(100000 + Math.random() * 900000)}`;
      const rideOtp = String(Math.floor(1000 + Math.random() * 9000));
      const shareToken = `${rideCode.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
      const nowIso = new Date().toISOString();

      const rideDoc: RideRecord = {
        id: rideRef.id,
        ride_code: rideCode,
        customer_id: customerUid,
        customer_uid: customerUid,
        customer_name:
          rideFor === 'someone_else'
            ? guestRiderName.trim()
            : userProfile?.full_name || 'SHINE CAB Rider',
        customer_phone:
          rideFor === 'someone_else'
            ? guestRiderPhone.trim()
            : userProfile?.phone || '',
        customer_short_id: userProfile?.short_id || '',
        driver_id: selectedDriverId || null,
        vehicle_id: null,
        category_id: selectedEstimate.categoryId,
        vehicle_slug: selectedEstimate.slug,
        status: 'searching',
        pickup_address: pickup.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        drop_address: drop.address,
        drop_lat: drop.lat,
        drop_lng: drop.lng,
        encoded_polyline: null,
        distance_meters: displayRouteMetrics.distanceMeters,
        duration_seconds: displayRouteMetrics.durationSeconds,
        base_fare: selectedEstimate.baseFare,
        distance_fare: selectedEstimate.distanceFare,
        time_fare: selectedEstimate.timeFare,
        waiting_fare: 0,
        night_fare: selectedEstimate.nightFare,
        surge_fare: selectedEstimate.surgeFare,
        platform_fee: selectedEstimate.platformFee,
        tax_amount: selectedEstimate.taxAmount,
        discount_amount: selectedEstimate.discountAmount,
        cancellation_fee: selectedEstimate.cancellationFee,
        total_fare: selectedEstimate.totalFare,
        payment_method: paymentMethod,
        payment_status: 'pending',
        ride_otp: rideOtp,
        share_token: shareToken,
        cancellation_reason: null,
        started_at: null,
        completed_at: null,
        cancelled_at: null,
        created_at: nowIso,
        vehicle_categories: { name: selectedEstimate.name, slug: selectedEstimate.slug },
        drivers: null,
        vehicles: null,
        ratings: [],
      };

      await setDoc(rideRef, {
        ...rideDoc,
        updated_at: nowIso,
      });

      if (appliedCoupon && selectedEstimate.discountAmount > 0) {
        await addDoc(collection(db, 'coupon_usage'), {
          customer_uid: customerUid,
          ride_id: rideRef.id,
          coupon_id: appliedCoupon.id,
          discount_applied: selectedEstimate.discountAmount,
          coupons: { code: appliedCoupon.code, title: appliedCoupon.title },
          used_at: nowIso,
        }).catch(() => {});
      }

      await addDoc(collection(db, 'user_notifications'), {
        user_id: customerUid,
        notification_type: 'booking_confirmation',
        title: `Ride Confirmed · ${rideCode}`,
        body: `Searching nearby ${selectedEstimate.name} captain. Your 4-digit start OTP is ${rideOtp}.`,
        deep_link: 'home',
        is_read: false,
        created_at: nowIso,
      }).catch(() => {});

      onRideCreated(rideDoc);
    } catch (err) {
      setBookingError('Could not save ride booking. Please check connection and retry.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'rides');
      } catch {
        // logged
      }
    } finally {
      setBookingLoading(false);
    }
  };

  const handleScheduleRide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickup || !drop || !selectedEstimate || !displayRouteMetrics) return;
    const scheduledIso = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
    if (Number.isNaN(Date.parse(scheduledIso)) || new Date(scheduledIso) <= new Date()) {
      setScheduleFeedback('Choose a valid future date and time.');
      return;
    }

    try {
      await addDoc(collection(db, 'scheduled_rides'), {
        customer_uid: customerUid,
        category_id: selectedEstimate.categoryId,
        vehicle_categories: { name: selectedEstimate.name, slug: selectedEstimate.slug },
        pickup_address: pickup.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        drop_address: drop.address,
        drop_lat: drop.lat,
        drop_lng: drop.lng,
        scheduled_for: scheduledIso,
        estimated_fare: selectedEstimate.totalFare,
        distance_meters: displayRouteMetrics.distanceMeters,
        duration_seconds: displayRouteMetrics.durationSeconds,
        payment_method: paymentMethod,
        status: 'scheduled',
        ride_id: null,
        created_at: new Date().toISOString(),
      });
      setShowScheduleModal(false);
      setScheduleFeedback(null);
      onNavigateTab('rides');
    } catch (err) {
      setScheduleFeedback('Unable to schedule ride right now.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'scheduled_rides');
      } catch {
        // logged
      }
    }
  };

  const homeAddr = savedAddresses.find((a) => a.address_type === 'home');
  const officeAddr = savedAddresses.find((a) => a.address_type === 'office');

  const activePickup: LocationPoint | null = activeRide
    ? { address: activeRide.pickup_address, lat: activeRide.pickup_lat, lng: activeRide.pickup_lng }
    : pickup;
  const activeDrop: LocationPoint | null = activeRide
    ? { address: activeRide.drop_address, lat: activeRide.drop_lat, lng: activeRide.drop_lng }
    : drop;

  const driverLatLng = tracking
    ? { lat: tracking.lat, lng: tracking.lng, heading: tracking.heading }
    : activeRide?.drivers?.current_lat && activeRide.drivers.current_lng
      ? {
          lat: activeRide.drivers.current_lat,
          lng: activeRide.drivers.current_lng,
          heading: activeRide.drivers.current_heading || 0,
        }
      : null;

  const serviceSlugs: VehicleSlug[] = ['bike', 'auto', 'cab'];
  const tripKmLabel = displayRouteMetrics
    ? (displayRouteMetrics.distanceMeters / 1000).toFixed(1)
    : '0.0';
  const activeCategoryName =
    selectedEstimate?.name || SERVICE_DESCRIPTIONS[selectedSlug].title;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      {/* Google Maps Platform Interactive Map with Custom Pickup/Drop-off Markers & Animated Active Route Polyline */}
      <div
        className={`relative shrink-0 transition-all duration-200 ${
          activeRide
            ? 'h-[40%]'
            : mapExpandedOnMobile
              ? 'h-[64%]'
              : pickup && drop
                ? 'h-[38%]'
                : 'h-[45%]'
        }`}
      >
        <RideMapCanvas
          googleMapsApiKey={googleMapsApiKey}
          pickup={activePickup}
          drop={activeDrop}
          driverLocation={driverLatLng}
          nearbyDrivers={activeRide ? [] : nearbyDriversMarkers}
          selectedDriverId={selectedDriverId}
          searchRadiusKm={searchRadiusKm}
          showSearchRadius={Boolean(showSearchRadius && !activeRide)}
          vehicleSlug={activeRide?.vehicle_categories?.slug || selectedSlug}
          isActiveRide={Boolean(activeRide)}
          pinSelectMode={activeRide ? null : pinSelectMode}
          routeMetrics={
            activeRide
              ? routeMetrics || {
                  distanceMeters: activeRide.distance_meters,
                  durationSeconds: activeRide.duration_seconds,
                }
              : pickup && drop
                ? displayRouteMetrics
                : null
          }
          liveSpeedKmh={liveSpeedKmh}
          onSelectNearbyDriver={(id) => {
            setSelectedDriverId(id);
            const found = nearbyDriversList.find((d) => d.id === id);
            if (found) setSelectedSlug(found.slug);
          }}
          onTogglePinSelect={(mode) => {
            setPinSelectMode(mode);
            if (mode) setMapExpandedOnMobile(true);
          }}
          onPickupClick={() => !activeRide && setSearchModalMode('pickup')}
          onMapSelectPoint={handleMapSelectPoint}
          onRequestCurrentGps={requestCurrentGps}
          onRouteComputed={(res) => setRouteMetrics(res)}
          gpsPermissionDenied={gpsDenied}
        />
      </div>

      {/* Bottom Sheet */}
      <div className="flex-1 min-h-0 bg-white rounded-t-3xl -mt-4 relative z-[410] border-t border-neutral-200 shadow-[0_-8px_28px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden">
        {!activeRide && (
          <div className="shrink-0 flex items-center justify-between px-4 pt-2 pb-1.5 border-b border-neutral-100/70">
            <span className="w-12" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setMapExpandedOnMobile((v) => !v)}
              aria-label={mapExpandedOnMobile ? 'Show booking options' : 'Expand map view'}
              className="flex flex-col items-center gap-1 py-0.5 px-3 rounded-xl hover:bg-neutral-50 cursor-pointer"
            >
              <span className="w-9 h-1 rounded-full bg-neutral-300" />
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#737373]">
                {mapExpandedOnMobile ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>Show options</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Full map</span>
                  </>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={onTriggerSos}
              aria-label="Emergency SOS"
              className="min-h-[36px] px-2.5 rounded-xl bg-red-50 text-[#DC2626] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>SOS</span>
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-3 pb-5 space-y-4">
          {activeRide ? (
            <ActiveRidePanel
              ride={activeRide}
              tracking={tracking}
              customerUid={customerUid}
              onRideUpdated={(updated) => onRideUpdated(updated)}
              onTriggerSos={onTriggerSos}
              onOpenChat={onOpenChat}
              onClearCompleted={() => {
                onRideUpdated(null);
                setDrop(null);
                setRouteMetrics(null);
              }}
            />
          ) : (
            <>
              {/* Dual-Location Search Card */}
              <div className="space-y-3">
                <div className="rounded-2xl border border-neutral-200 bg-[#F7F8FA] p-2.5 space-y-2 relative">
                  <button
                    type="button"
                    onClick={() => setSearchModalMode('pickup')}
                    className="w-full min-h-[46px] px-3 py-2 rounded-xl bg-white border border-neutral-200 flex items-center gap-3 text-left hover:border-neutral-300 cursor-pointer"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A] shrink-0" />
                    <div className="min-w-0 flex-1 pr-7">
                      <p className="text-[11px] font-medium text-[#737373]">Pickup location</p>
                      <p className="text-xs sm:text-sm font-semibold text-[#111111] truncate">
                        {pickup ? pickup.address : 'Tap to search pickup or GPS'}
                      </p>
                    </div>
                  </button>

                  {(pickup || drop) && (
                    <button
                      type="button"
                      onClick={handleSwapLocations}
                      aria-label="Swap pickup and drop locations"
                      className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-[#111111] text-[#F5C518] shadow-md flex items-center justify-center hover:scale-105 transition cursor-pointer"
                    >
                      <ArrowUpDown className="w-4 h-4" />
                    </button>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSearchModalMode('drop')}
                      className="flex-1 min-w-0 min-h-[48px] px-3 py-2 rounded-xl bg-white border border-neutral-200 flex items-center gap-3 text-left hover:border-[#111111] cursor-pointer"
                    >
                      <span className="w-6 h-6 rounded-lg bg-[#F5C518] text-[#111111] flex items-center justify-center shrink-0">
                        <Search className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0 flex-1 pr-6">
                        <p className="text-[11px] font-medium text-[#737373]">Drop location</p>
                        <p className="text-sm font-bold text-[#111111] truncate">
                          {drop ? drop.address : 'Where are you going?'}
                        </p>
                      </div>
                    </button>
                    {drop ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDrop(null);
                          setRouteMetrics(null);
                        }}
                        aria-label="Clear destination"
                        className="min-h-[48px] min-w-[44px] rounded-xl bg-white border border-neutral-200 flex items-center justify-center text-[#737373] hover:text-[#111111] cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setPinSelectMode(pinSelectMode === 'drop' ? null : 'drop');
                          setMapExpandedOnMobile(true);
                        }}
                        className={`min-h-[48px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0 ${
                          pinSelectMode === 'drop'
                            ? 'bg-[#111111] text-[#F5C518] border-[#111111]'
                            : 'bg-white text-[#111111] border-neutral-200 hover:bg-neutral-50'
                        }`}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Pin</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Saved Places & Schedule Quick Strip */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  {homeAddr && (
                    <button
                      type="button"
                      onClick={() => {
                        setDrop({
                          address: homeAddr.address_line,
                          lat: homeAddr.lat,
                          lng: homeAddr.lng,
                        });
                        setMapExpandedOnMobile(false);
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 hover:bg-[#F7F8FA] shrink-0 whitespace-nowrap cursor-pointer"
                    >
                      <Home className="w-3.5 h-3.5 text-[#16A34A]" />
                      <span>Home</span>
                    </button>
                  )}
                  {officeAddr && (
                    <button
                      type="button"
                      onClick={() => {
                        setDrop({
                          address: officeAddr.address_line,
                          lat: officeAddr.lat,
                          lng: officeAddr.lng,
                        });
                        setMapExpandedOnMobile(false);
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 hover:bg-[#F7F8FA] shrink-0 whitespace-nowrap cursor-pointer"
                    >
                      <Briefcase className="w-3.5 h-3.5 text-[#111111]" />
                      <span>Office</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onNavigateTab('profile')}
                    className="min-h-[40px] px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 hover:bg-[#F7F8FA] shrink-0 whitespace-nowrap cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#737373]" />
                    <span>{homeAddr || officeAddr ? 'Saved Places' : '+ Save Home / Work'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!drop) {
                        setSearchModalMode('drop');
                        return;
                      }
                      setShowScheduleModal(true);
                    }}
                    className="min-h-[40px] px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 hover:bg-[#F7F8FA] shrink-0 whitespace-nowrap cursor-pointer"
                  >
                    <CalendarClock className="w-3.5 h-3.5 text-[#111111]" />
                    <span>Schedule Ride</span>
                  </button>
                </div>
              </div>

              {/* Browse Mode (Before Drop is Set) */}
              {(!pickup || !drop) && (
                <div className="space-y-5">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-sm font-bold text-[#111111]">
                        Explore Services
                      </h2>
                      <span className="text-[11px] text-[#737373]">Live admin tariff</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      {serviceSlugs.map((slug) => {
                        const preview = categoryPreviewEstimates.find((c) => c.slug === slug);
                        const info = SERVICE_DESCRIPTIONS[slug];
                        const isSelected = selectedSlug === slug;
                        return (
                          <button
                            key={slug}
                            type="button"
                            onClick={() => {
                              setSelectedSlug(slug);
                              if (!drop) setSearchModalMode('drop');
                            }}
                            className={`p-2.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between min-h-[112px] ${
                              isSelected
                                ? 'border-[#111111] bg-[#F5C518]/20'
                                : 'border-neutral-200 bg-[#F7F8FA] hover:bg-neutral-100'
                            }`}
                          >
                            <div className="w-full h-14 rounded-xl bg-white overflow-hidden flex items-center justify-center mb-2">
                              {!imgFailed[slug] ? (
                                <img
                                  src={VEHICLE_IMAGES[slug]}
                                  alt={preview?.name || info.title}
                                  referrerPolicy="no-referrer"
                                  onError={() =>
                                    setImgFailed((prev) => ({ ...prev, [slug]: true }))
                                  }
                                  className="w-full h-full object-cover"
                                />
                              ) : slug === 'bike' ? (
                                <Bike className="w-6 h-6 text-[#111111]" />
                              ) : (
                                <Car className="w-6 h-6 text-[#111111]" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-display text-xs sm:text-sm font-bold text-[#111111]">
                                  {preview?.name || info.title}
                                </span>
                                {preview && (
                                  <span className="font-mono-num text-[11px] font-bold text-[#111111]">
                                    ₹{preview.totalFare}+
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#737373] truncate mt-0.5">
                                {preview?.perKmRate
                                  ? `₹${preview.perKmRate}/km · ${preview.availableDrivers} live`
                                  : info.subtitle}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Nearby Vehicles Scanner */}
                  <div className="rounded-2xl border border-neutral-200 bg-[#F7F8FA] p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-display text-sm font-bold text-[#111111]">
                          Search Nearby Vehicles
                        </h2>
                        <p className="text-[11px] text-[#737373]">
                          Show pickup radius on map & live captains
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!pickup) {
                            setSearchModalMode('pickup');
                            return;
                          }
                          setShowSearchRadius(true);
                          setNearbySearched(true);
                        }}
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#111111] text-[#F5C518] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-900 cursor-pointer shrink-0"
                      >
                        <Radar className="w-4 h-4" />
                        <span>Scan {searchRadiusKm} km</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {[2, 5, 8, 10].map((km) => (
                        <button
                          key={km}
                          type="button"
                          onClick={() => {
                            setSearchRadiusKm(km);
                            setShowSearchRadius(true);
                            setNearbySearched(true);
                          }}
                          className={`flex-1 min-h-[38px] rounded-xl text-xs font-mono-num font-semibold border transition cursor-pointer ${
                            searchRadiusKm === km && showSearchRadius
                              ? 'bg-[#F5C518] text-[#111111] border-[#111111]'
                              : 'bg-white text-[#111111] border-neutral-200 hover:bg-neutral-50'
                          }`}
                        >
                          {km} km
                        </button>
                      ))}
                      {showSearchRadius && (
                        <button
                          type="button"
                          onClick={() => setShowSearchRadius(false)}
                          className="min-h-[38px] px-2.5 rounded-xl border border-neutral-200 bg-white text-[11px] font-semibold text-[#737373] hover:text-[#111111] cursor-pointer"
                        >
                          Hide
                        </button>
                      )}
                    </div>

                    {nearbySearched && (
                      nearbyDriversList.length === 0 ? (
                        <div className="rounded-xl border border-neutral-200 bg-white p-3.5 text-center space-y-1">
                          <p className="text-xs font-semibold text-[#111111]">
                            No online captains active within {searchRadiusKm} km
                          </p>
                          <p className="text-[11px] text-[#737373]">
                            Expand search radius or book directly — nearby captains receive your request live.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold text-[#111111]">
                            {nearbyDriversList.length} verified captain{nearbyDriversList.length > 1 ? 's' : ''} online
                          </p>
                          {nearbyDriversList.map((drv) => {
                            const isPicked = selectedDriverId === drv.id;
                            return (
                              <div
                                key={drv.id}
                                className={`rounded-2xl border p-3 bg-white space-y-2.5 ${
                                  isPicked ? 'border-[#111111] ring-1 ring-[#F5C518]' : 'border-neutral-200'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2.5">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-11 h-11 rounded-full bg-[#111111] text-[#F5C518] font-display text-sm font-bold flex items-center justify-center shrink-0 overflow-hidden">
                                      {drv.avatarUrl ? (
                                        <img
                                          src={drv.avatarUrl}
                                          alt={drv.name}
                                          referrerPolicy="no-referrer"
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        drv.name.charAt(0).toUpperCase()
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs sm:text-sm font-bold text-[#111111] truncate">
                                        {drv.name}
                                      </p>
                                      <p className="text-[11px] text-[#737373] truncate">
                                        {drv.vehicle.color} {drv.vehicle.make} {drv.vehicle.model}
                                      </p>
                                      <div className="flex items-center gap-1.5 text-[11px] text-[#737373] mt-0.5">
                                        <Star className="w-3 h-3 text-[#F5C518] fill-[#F5C518]" />
                                        <span className="font-mono-num font-semibold text-[#111111]">
                                          {drv.ratingAvg.toFixed(1)}
                                        </span>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono-num">
                                          {drv.distanceKm} km ({drv.etaMinutes} min)
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="font-mono-num text-[11px] font-bold px-2 py-1 rounded-lg bg-[#F7F8FA] border border-neutral-200 text-[#111111]">
                                      {drv.vehicle.registrationNumber}
                                    </p>
                                    <p className="text-[11px] text-[#737373] mt-1">
                                      {drv.categoryName}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100">
                                  {drv.phone ? (
                                    <a
                                      href={`tel:${drv.phone}`}
                                      className="min-h-[38px] px-3 rounded-xl border border-neutral-200 text-[11px] font-mono-num font-semibold text-[#111111] inline-flex items-center gap-1.5 hover:bg-neutral-50"
                                    >
                                      <Phone className="w-3.5 h-3.5" />
                                      <span>{drv.phone}</span>
                                    </a>
                                  ) : (
                                    <span className="text-[11px] text-[#737373]">Verified Captain</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedDriverId(drv.id);
                                      setSelectedSlug(drv.slug);
                                      if (!drop) setSearchModalMode('drop');
                                    }}
                                    className="min-h-[38px] px-3.5 rounded-xl bg-[#F5C518] text-[#111111] text-xs font-bold hover:brightness-95 cursor-pointer"
                                  >
                                    {isPicked ? 'Selected · Set Drop' : 'Book Captain'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )
                    )}
                  </div>

                  {/* Recent Destinations */}
                  {recentDestinations.length > 0 && (
                    <div className="space-y-2">
                      <h2 className="font-display text-sm font-bold text-[#111111]">
                        Recent Destinations
                      </h2>
                      <div className="border border-neutral-200 rounded-2xl divide-y divide-neutral-100 overflow-hidden bg-white">
                        {recentDestinations.slice(0, 3).map((rec, i) => (
                          <button
                            key={`${rec.lat}-${rec.lng}-${i}`}
                            type="button"
                            onClick={() => {
                              setDrop(rec);
                              setMapExpandedOnMobile(false);
                            }}
                            className="w-full min-h-[52px] px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#F7F8FA] text-left cursor-pointer"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="w-8 h-8 rounded-full bg-[#F7F8FA] flex items-center justify-center shrink-0">
                                <Clock className="w-4 h-4 text-[#111111]" />
                              </span>
                              <span className="text-xs font-medium text-[#111111] truncate">
                                {rec.address}
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Nearby OpenStreetMap Landmarks */}
                  {(landmarksLoading || nearbyLandmarks.length > 0) && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h2 className="font-display text-sm font-bold text-[#111111]">
                          Nearby Popular Stops
                        </h2>
                        <span className="text-[11px] text-[#737373]">One-tap drop</span>
                      </div>
                      {landmarksLoading ? (
                        <div className="space-y-2">
                          <div className="h-12 bg-neutral-100 rounded-xl animate-pulse" />
                        </div>
                      ) : (
                        <div className="border border-neutral-200 rounded-2xl divide-y divide-neutral-100 overflow-hidden bg-white">
                          {nearbyLandmarks.slice(0, 4).map((lm) => (
                            <button
                              key={lm.id}
                              type="button"
                              onClick={() => {
                                setDrop({
                                  address: lm.address,
                                  lat: lm.lat,
                                  lng: lm.lng,
                                  placeId: lm.placeId,
                                });
                                setMapExpandedOnMobile(false);
                              }}
                              className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#F7F8FA] text-left cursor-pointer"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-8 h-8 rounded-full bg-[#F5C518]/25 text-[#111111] flex items-center justify-center shrink-0">
                                  <Compass className="w-4 h-4" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[#111111] truncate">
                                    {lm.name}
                                  </p>
                                  <p className="text-[11px] text-[#737373] truncate">
                                    {lm.categoryLabel} · {lm.address}
                                  </p>
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Active Promo Offers from Firestore */}
                  {coupons.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h2 className="font-display text-sm font-bold text-[#111111]">
                          Offers & Savings
                        </h2>
                        <button
                          type="button"
                          onClick={() => onNavigateTab('offers')}
                          className="text-xs font-semibold text-[#111111] underline underline-offset-4 cursor-pointer"
                        >
                          View all
                        </button>
                      </div>
                      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                        {coupons.map((offer) => (
                          <button
                            key={offer.id}
                            type="button"
                            onClick={() => {
                              setPromoInput(offer.code);
                              setAppliedCoupon(offer);
                              setSearchModalMode('drop');
                            }}
                            className="min-w-[210px] p-3 rounded-2xl border border-neutral-200 bg-[#1E1E1E] text-white text-left shrink-0 hover:bg-neutral-900 cursor-pointer space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-num text-xs font-bold text-[#F5C518]">
                                {offer.code}
                              </span>
                              <Tag className="w-3.5 h-3.5 text-[#F5C518]" />
                            </div>
                            <p className="text-xs font-semibold truncate">{offer.title}</p>
                            <p className="text-[11px] text-neutral-300 truncate">
                              {offer.description}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Safety & Quick Actions */}
                  <div className="space-y-2">
                    <h2 className="font-display text-sm font-bold text-[#111111]">
                      Safety & Quick Actions
                    </h2>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => onNavigateTab('offers')}
                        className="min-h-[56px] p-3 rounded-2xl border border-neutral-200 bg-[#F7F8FA] text-left hover:bg-neutral-100 cursor-pointer flex items-start gap-2.5"
                      >
                        <Tag className="w-4 h-4 text-[#111111] mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#111111]">Promo Offers</p>
                          <p className="text-[11px] text-[#737373] mt-0.5 truncate">Coupons & discounts</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateTab('rides')}
                        className="min-h-[56px] p-3 rounded-2xl border border-neutral-200 bg-[#F7F8FA] text-left hover:bg-neutral-100 cursor-pointer flex items-start gap-2.5"
                      >
                        <Receipt className="w-4 h-4 text-[#111111] mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#111111]">My Rides</p>
                          <p className="text-[11px] text-[#737373] mt-0.5 truncate">Trips & receipts</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={onTriggerSos}
                        className="min-h-[56px] p-3 rounded-2xl border border-neutral-200 bg-[#F7F8FA] text-left hover:bg-neutral-100 cursor-pointer flex items-start gap-2.5"
                      >
                        <ShieldCheck className="w-4 h-4 text-[#16A34A] mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#111111]">24/7 Safety Shield</p>
                          <p className="text-[11px] text-[#737373] mt-0.5 truncate">OTP start & SOS</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateTab('support')}
                        className="min-h-[56px] p-3 rounded-2xl border border-neutral-200 bg-[#F7F8FA] text-left hover:bg-neutral-100 cursor-pointer flex items-start gap-2.5"
                      >
                        <Share2 className="w-4 h-4 text-[#111111] mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#111111]">Help & Support</p>
                          <p className="text-[11px] text-[#737373] mt-0.5 truncate">24/7 ride assistance</p>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Active Route & Admin-Configured Fare Selection */}
              {pickup && drop && displayRouteMetrics && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-[#737373] border-y border-neutral-100 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#111111]">
                        <Navigation className="w-3.5 h-3.5" />
                        <span className="font-mono-num font-semibold">{tripKmLabel} km</span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#111111]">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="font-mono-num font-semibold">
                          {Math.max(1, Math.round(displayRouteMetrics.durationSeconds / 60))} min
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowScheduleModal(true)}
                      className="inline-flex items-center gap-1 font-semibold text-[#111111] hover:underline cursor-pointer min-h-[36px]"
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      <span>Schedule</span>
                    </button>
                  </div>

                  {/* Vehicle Fare Cards */}
                  <div className="space-y-2">
                    {estimates.map((est) => {
                      const isSelected = est.slug === selectedEstimate?.slug;
                      return (
                        <div
                          key={est.categoryId}
                          className={`rounded-2xl border transition ${
                            isSelected
                              ? 'border-[#111111] bg-[#F5C518]/20'
                              : 'border-neutral-200 bg-white hover:bg-[#F7F8FA]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedSlug(est.slug)}
                            className="w-full p-3 text-left flex items-center gap-3 cursor-pointer"
                          >
                            <div className="w-16 h-12 rounded-xl bg-[#F7F8FA] overflow-hidden flex items-center justify-center shrink-0">
                              {!imgFailed[est.slug] ? (
                                <img
                                  src={VEHICLE_IMAGES[est.slug]}
                                  alt={est.name}
                                  referrerPolicy="no-referrer"
                                  onError={() =>
                                    setImgFailed((prev) => ({ ...prev, [est.slug]: true }))
                                  }
                                  className="w-full h-full object-cover"
                                />
                              ) : est.slug === 'bike' ? (
                                <Bike className="w-6 h-6 text-[#111111]" />
                              ) : (
                                <Car className="w-6 h-6 text-[#111111]" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-display font-bold text-sm text-[#111111]">
                                    {est.name}
                                  </span>
                                  {est.surgeMultiplier > 1 && (
                                    <span className="font-mono-num text-[11px] font-semibold text-amber-700">
                                      {est.surgeMultiplier}x
                                    </span>
                                  )}
                                </div>
                                <span className="font-mono-num font-bold text-base text-[#111111]">
                                  ₹{est.totalFare.toFixed(0)}
                                </span>
                              </div>
                              <div className="text-xs text-[#737373] flex items-center flex-wrap gap-1.5 mt-0.5">
                                <span className="font-mono-num font-semibold text-[#111111]">
                                  {tripKmLabel} km
                                </span>
                                {typeof est.perKmRate === 'number' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono-num">₹{est.perKmRate}/km</span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span>
                                  {est.capacity} seat{est.capacity > 1 ? 's' : ''}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {est.availableDrivers > 0
                                    ? `${est.availableDrivers} nearby`
                                    : 'Instant book'}
                                </span>
                              </div>
                            </div>
                          </button>

                          {isSelected && (
                            <div className="px-3 pb-2.5 flex items-center justify-between border-t border-neutral-200/70 pt-2">
                              <button
                                type="button"
                                onClick={() => setShowFareBreakup((v) => !v)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#111111] hover:underline cursor-pointer"
                              >
                                <Info className="w-3.5 h-3.5" />
                                <span>
                                  {showFareBreakup ? 'Hide fare breakup' : 'View fare breakup'}
                                </span>
                              </button>
                              <span className="text-[11px] text-[#737373] font-mono-num">
                                {est.cancellationFee > 0
                                  ? `Cancel fee ₹${est.cancellationFee}`
                                  : 'Free cancel'}
                              </span>
                            </div>
                          )}

                          {isSelected && showFareBreakup && (
                            <div className="px-3 pb-3 space-y-1 text-xs text-[#737373]">
                              <div className="flex justify-between">
                                <span>Base Fare</span>
                                <span className="font-mono-num text-[#111111]">
                                  ₹{est.baseFare.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>
                                  Distance ({tripKmLabel} km × ₹{est.perKmRate}/km)
                                </span>
                                <span className="font-mono-num text-[#111111]">
                                  ₹{est.distanceFare.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Ride Time Charge</span>
                                <span className="font-mono-num text-[#111111]">
                                  ₹{est.timeFare.toFixed(2)}
                                </span>
                              </div>
                              {est.surgeFare > 0 && (
                                <div className="flex justify-between">
                                  <span>Peak demand</span>
                                  <span className="font-mono-num text-[#111111]">
                                    ₹{est.surgeFare.toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {est.discountAmount > 0 && (
                                <div className="flex justify-between text-[#16A34A] font-medium">
                                  <span>Promo discount</span>
                                  <span className="font-mono-num">
                                    -₹{est.discountAmount.toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Promo Code Bar */}
                  <div className="flex gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Tag className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Apply promo code"
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                        className="w-full h-11 rounded-xl border border-neutral-200 pl-9 pr-3 text-xs font-mono-num uppercase focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyPromoCode}
                      className="min-h-[44px] px-4 rounded-xl bg-neutral-100 text-xs font-semibold text-[#111111] hover:bg-neutral-200 cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                  {appliedCoupon && (
                    <p className="text-xs text-[#16A34A] font-medium">
                      Applied {appliedCoupon.code}: {appliedCoupon.title}
                    </p>
                  )}
                  {couponError && <p className="text-xs text-[#DC2626]">{couponError}</p>}

                  {/* Ride For & Payment Mode */}
                  <div className="rounded-2xl border border-neutral-200 bg-[#F7F8FA] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Booking for</span>
                      </span>
                      <div className="flex items-center gap-1 bg-white rounded-xl p-1 border border-neutral-200">
                        <button
                          type="button"
                          onClick={() => setRideFor('myself')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                            rideFor === 'myself'
                              ? 'bg-[#111111] text-[#F5C518]'
                              : 'text-[#737373]'
                          }`}
                        >
                          Myself
                        </button>
                        <button
                          type="button"
                          onClick={() => setRideFor('someone_else')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                            rideFor === 'someone_else'
                              ? 'bg-[#111111] text-[#F5C518]'
                              : 'text-[#737373]'
                          }`}
                        >
                          Someone Else
                        </button>
                      </div>
                    </div>

                    {rideFor === 'someone_else' && (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Rider name"
                          value={guestRiderName}
                          onChange={(e) => setGuestRiderName(e.target.value)}
                          className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                        />
                        <input
                          type="tel"
                          placeholder="Rider phone"
                          value={guestRiderPhone}
                          onChange={(e) => setGuestRiderPhone(e.target.value)}
                          className="h-10 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-mono-num focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-neutral-700">Payment Mode</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['upi', 'online', 'cash'] as PaymentMethod[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setPaymentMethod(m)}
                            className={`min-h-[42px] rounded-xl text-xs font-semibold border cursor-pointer ${
                              paymentMethod === m
                                ? 'bg-[#111111] text-[#F5C518] border-[#111111]'
                                : 'bg-white text-[#111111] border-neutral-200'
                            }`}
                          >
                            {m === 'upi' ? 'UPI' : m === 'online' ? 'Card / Net' : 'Cash'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {bookingError && (
                    <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-[#DC2626]">
                      {bookingError}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Docked Book Ride Button */}
        {!activeRide && pickup && drop && displayRouteMetrics && (
          <div className="shrink-0 bg-white/95 backdrop-blur-md px-4 py-2.5 border-t border-neutral-100 z-20">
            <button
              type="button"
              disabled={bookingLoading}
              onClick={handleConfirmBooking}
              className="w-full min-h-[50px] rounded-2xl bg-[#F5C518] text-[#111111] font-display font-bold text-sm hover:brightness-95 disabled:opacity-60 transition cursor-pointer shadow-md active:scale-[0.99]"
            >
              {bookingLoading
                ? 'Booking Your Ride...'
                : selectedEstimate
                  ? `Book ${selectedEstimate.name} · ${tripKmLabel} km · ₹${selectedEstimate.totalFare.toFixed(0)}`
                  : `Book ${activeCategoryName} · ${tripKmLabel} km`}
            </button>
          </div>
        )}
      </div>

      {/* Free OpenStreetMap Nominatim Address Search Modal */}
      {searchModalMode && (
        <LocationSearchModal
          mode={searchModalMode}
          savedAddresses={savedAddresses}
          recentDestinations={recentDestinations}
          biasLocation={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
          onSelectLocation={(loc) => {
            if (searchModalMode === 'pickup') {
              setPickup(loc);
            } else {
              setDrop(loc);
              setMapExpandedOnMobile(false);
            }
            setSearchModalMode(null);
          }}
          onSelectOnMap={() => {
            setPinSelectMode(searchModalMode);
            setMapExpandedOnMobile(true);
            setSearchModalMode(null);
          }}
          onUseCurrentGps={requestCurrentGps}
          onClose={() => setSearchModalMode(null)}
        />
      )}

      {/* Schedule Ride Bottom Sheet */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-end justify-center">
          <form
            onSubmit={handleScheduleRide}
            className="bg-white rounded-t-3xl w-full p-5 pb-[max(env(safe-area-inset-bottom),16px)] space-y-4 shadow-xl border-t border-neutral-200"
          >
            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto" />
            <h3 className="font-display text-lg font-bold text-[#111111]">Schedule a Ride</h3>
            <p className="text-xs text-[#737373]">
              A captain will be dispatched ahead of your scheduled pickup time.
            </p>
            <div className="space-y-3">
              <label className="block space-y-1 text-xs font-semibold text-neutral-700">
                <span>Pickup Date</span>
                <input
                  type="date"
                  required
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full h-11 rounded-xl border border-neutral-300 px-3"
                />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-neutral-700">
                <span>Pickup Time</span>
                <input
                  type="time"
                  required
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full h-11 rounded-xl border border-neutral-300 px-3"
                />
              </label>
            </div>
            {scheduleFeedback && (
              <p className="text-xs text-[#DC2626] font-medium">{scheduleFeedback}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="min-h-[44px] rounded-xl border border-neutral-200 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-[#F5C518] text-[#111111] text-xs font-semibold cursor-pointer"
              >
                Confirm Schedule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
