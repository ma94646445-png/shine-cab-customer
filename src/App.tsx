import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Home, Car, Tag, LifeBuoy, User, Bell, MessageSquare, X, Megaphone, ExternalLink, ArrowRight } from 'lucide-react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { loadAppConfig } from './lib/config';
import { auth, db, generateShortCustomerId } from './lib/firebase';
import {
  AppConfig,
  Coupon,
  CustomerProfile,
  EmergencyContact,
  LiveNotificationAlert,
  LocationPoint,
  NotificationRecord,
  PaymentMethod,
  PaymentRecord,
  RideRecord,
  RideTrackingPoint,
  SavedAddress,
  ScheduledRide,
  SosAlertRecord,
  SupportTicket,
  UserProfile,
} from './types/shinecab';
import { ShineCabLogo } from './components/ShineCabLogo';
import { SplashScreen, OnboardingScreen } from './components/SplashAndOnboarding';
import { AuthScreen } from './components/AuthScreen';
import { HomeBookingView } from './components/HomeBookingView';
import { RidesHistoryView } from './components/RidesHistoryView';
import { OffersView } from './components/OffersView';
import { SupportView } from './components/SupportView';
import { ProfileView } from './components/ProfileView';
import { NotificationsView } from './components/NotificationsView';
import { DriverChatView } from './components/DriverChatView';
import { EmergencySosModal } from './components/EmergencySosModal';
import { OfflineIndicator } from './components/PWAInstallBanner';
import { SharedTripView } from './components/SharedTripView';
import { PhoneFrame } from './components/PhoneFrame';

type NavTab = 'home' | 'rides' | 'offers' | 'notifications' | 'support' | 'profile' | 'chat';

const ACTIVE_RIDE_STATUSES = new Set([
  'searching',
  'searching_driver',
  'driver_assigned',
  'arrived',
  'driver_arriving',
  'driver_reached_pickup',
  'otp_verification',
  'in_progress',
  'ride_started',
  'completed',
  'ride_completed',
  'payment_pending',
]);

function sortByDateDesc<T extends { created_at?: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [showSplash, setShowSplash] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('shinecab_onboarding_v3_seen') === 'true';
  });

  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup'>('login');
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [liveConnected, setLiveConnected] = useState(false);
  const [showSosModal, setShowSosModal] = useState(false);
  const [preAppliedCoupon, setPreAppliedCoupon] = useState<string | null>(null);
  const [supportRideId, setSupportRideId] = useState<string | null>(null);
  const [selectedChatRideId, setSelectedChatRideId] = useState<string | null>(null);

  // Real-time Firestore domain state
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userDocLoaded, setUserDocLoaded] = useState(false);
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [scheduledRides, setScheduledRides] = useState<ScheduledRide[]>([]);
  const [dismissedRideIds, setDismissedRideIds] = useState<string[]>([]);
  const [driverDocTracking, setDriverDocTracking] = useState<RideTrackingPoint | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponUsage, setCouponUsage] = useState<any[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [userNotifications, setUserNotifications] = useState<NotificationRecord[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<LiveNotificationAlert[]>([]);
  const [readBroadcastIds, setReadBroadcastIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('shinecab_read_broadcasts');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [dismissedBannerIds, setDismissedBannerIds] = useState<string[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [sosAlerts, setSosAlerts] = useState<SosAlertRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const shareTokenParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('share')
      : null;
  const [shareToken, setShareToken] = useState<string | null>(shareTokenParam);

  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  // Listen for Google Maps Platform Demo Key quota exhaustion events
  useEffect(() => {
    const onQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Load optional runtime config cleanly (never blocks Firebase)
  useEffect(() => {
    let mounted = true;
    loadAppConfig().then((cfg) => {
      if (mounted) setConfig(cfg);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthChecked(true);
      if (!user) {
        setUserProfile(null);
        setUserDocLoaded(false);
        setRides([]);
        setScheduledRides([]);
        setSavedAddresses([]);
        setEmergencyContacts([]);
        setPayments([]);
        setUserNotifications([]);
        setTickets([]);
        setSosAlerts([]);
        setCouponUsage([]);
        setLiveConnected(false);
      } else if (localStorage.getItem('shinecab_onboarding_v3_seen') === 'true') {
        setOnboardingDone(true);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to public/shared active coupons & live_notifications
  useEffect(() => {
    const unsubCoupons = onSnapshot(
      collection(db, 'coupons'),
      (snap) => {
        const now = Date.now();
        const activeList = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as Coupon & { is_active?: boolean })
          .filter((c) => {
            if (c.is_active === false) return false;
            if (c.expires_at && new Date(c.expires_at).getTime() <= now) return false;
            return true;
          });
        setCoupons(activeList);
      },
      (err) => console.error('Coupons listener error:', err)
    );

    const unsubAlerts = onSnapshot(
      collection(db, 'live_notifications'),
      (snap) => {
        const alerts = snap.docs
          .map((d) => {
            const raw = d.data() as Record<string, any>;
            return {
              id: d.id,
              title: String(raw.title || 'SHINE CAB Alert'),
              message: String(raw.message || raw.body || ''),
              targetAudience: String(raw.targetAudience || raw.target_audience || 'all'),
              active: raw.active !== false,
              actionLink: raw.actionLink || raw.action_link || null,
              created_at:
                typeof raw.created_at === 'string'
                  ? raw.created_at
                  : raw.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            } as LiveNotificationAlert;
          })
          .filter(
            (a) =>
              a.active === true &&
              ['all', 'customers', 'customer'].includes((a.targetAudience || 'all').toLowerCase())
          );
        setLiveAlerts(sortByDateDesc(alerts));
        setLiveConnected(true);
      },
      (err) => {
        console.error('live_notifications listener error:', err);
      }
    );

    return () => {
      unsubCoupons();
      unsubAlerts();
    };
  }, [refreshTick]);

  // Subscribe to authenticated customer's Firestore collections in real time
  useEffect(() => {
    const uid = firebaseUser?.uid;
    if (!uid) return;

    setDataLoading(true);
    const unsubscribers: (() => void)[] = [];

    // 1. User profile doc
    unsubscribers.push(
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as Record<string, any>;
            setUserProfile({
              id: uid,
              uid,
              phone: String(data.phone || firebaseUser.phoneNumber || ''),
              email: data.email || null,
              full_name: data.full_name || null,
              short_id:
                data.short_id ||
                generateShortCustomerId(String(data.phone || ''), data.full_name || null),
              avatar_url: data.avatar_url || null,
              language_preference: String(data.language_preference || 'en'),
              created_at:
                typeof data.created_at === 'string'
                  ? data.created_at
                  : data.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString(),
              ...data,
            } as UserProfile & Record<string, any>);
          } else {
            setUserProfile(null);
          }
          setUserDocLoaded(true);
          setDataLoading(false);
        },
        (err) => {
          console.error('User doc listener error:', err);
          setUserDocLoaded(true);
          setDataLoading(false);
        }
      )
    );

    // 2. Rides (real-time status transitions & driver assignments)
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'rides'), where('customer_uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map((d) => {
            const raw = d.data() as Record<string, any>;
            return {
              id: d.id,
              ...raw,
              created_at:
                typeof raw.created_at === 'string'
                  ? raw.created_at
                  : raw.created_at?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            } as RideRecord;
          });
          setRides(sortByDateDesc(list));
          setLiveConnected(true);
        },
        (err) => console.error('Rides listener error:', err)
      )
    );

    // 3. Scheduled rides
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'scheduled_rides'), where('customer_uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as ScheduledRide
          );
          list.sort(
            (a, b) =>
              new Date(a.scheduled_for || 0).getTime() - new Date(b.scheduled_for || 0).getTime()
          );
          setScheduledRides(list);
        },
        (err) => console.error('Scheduled rides listener error:', err)
      )
    );

    // 4. Saved addresses
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'saved_addresses'), where('customer_uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as SavedAddress
          );
          setSavedAddresses(list);
        },
        (err) => console.error('Saved addresses listener error:', err)
      )
    );

    // 5. Emergency contacts
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'emergency_contacts'), where('customer_uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as EmergencyContact
          );
          setEmergencyContacts(list);
        },
        (err) => console.error('Emergency contacts listener error:', err)
      )
    );

    // 6. Payments
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'payments'), where('customer_uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as PaymentRecord
          );
          setPayments(sortByDateDesc(list));
        },
        (err) => console.error('Payments listener error:', err)
      )
    );

    // 7. Personal notifications
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'user_notifications'), where('user_id', '==', uid)),
        (snap) => {
          const list = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as NotificationRecord
          );
          setUserNotifications(sortByDateDesc(list));
        },
        (err) => console.error('User notifications listener error:', err)
      )
    );

    // 8. Support tickets
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'support_tickets'), where('customer_uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as SupportTicket
          );
          setTickets(sortByDateDesc(list));
        },
        (err) => console.error('Support tickets listener error:', err)
      )
    );

    // 9. SOS alerts
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'sos_alerts'), where('customer_uid', '==', uid)),
        (snap) => {
          const list = snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as SosAlertRecord
          );
          setSosAlerts(sortByDateDesc(list));
        },
        (err) => console.error('SOS alerts listener error:', err)
      )
    );

    // 10. Coupon usage history
    unsubscribers.push(
      onSnapshot(
        query(collection(db, 'coupon_usage'), where('customer_uid', '==', uid)),
        (snap) => {
          const list: Record<string, any>[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Record<string, any>),
          }));
          list.sort(
            (a, b) => new Date(b.used_at || 0).getTime() - new Date(a.used_at || 0).getTime()
          );
          setCouponUsage(list);
        },
        (err) => console.error('Coupon usage listener error:', err)
      )
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [firebaseUser?.uid, firebaseUser?.phoneNumber, refreshTick]);

  // Derive activeRide dynamically from Firestore rides
  const activeRide = useMemo(() => {
    return (
      rides.find(
        (r) => ACTIVE_RIDE_STATUSES.has(r.status) && !dismissedRideIds.includes(r.id)
      ) || null
    );
  }, [rides, dismissedRideIds]);

  // Live driver GPS subscription whenever activeRide has an assigned driver_id
  useEffect(() => {
    if (!activeRide?.driver_id) {
      setDriverDocTracking(null);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'drivers', activeRide.driver_id),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as Record<string, any>;
        const lat = Number(d.current_lat ?? d.lat);
        const lng = Number(d.current_lng ?? d.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        setDriverDocTracking({
          id: snap.id,
          ride_id: activeRide.id,
          driver_id: activeRide.driver_id!,
          lat,
          lng,
          heading: Number(d.current_heading ?? d.heading ?? 0),
          speed_kmh: Number(d.speed_kmh ?? 0),
          eta_seconds: d.eta_seconds ?? null,
          distance_remaining_meters: d.distance_remaining_meters ?? null,
          recorded_at: new Date().toISOString(),
        });
      },
      (err) => console.error('Live driver GPS listener error:', err)
    );

    return () => unsub();
  }, [activeRide?.id, activeRide?.driver_id]);

  // Resolved live tracking (prefers live driver doc, falls back to ride.drivers coords)
  const liveTracking: RideTrackingPoint | null = useMemo(() => {
    if (driverDocTracking) return driverDocTracking;
    if (
      activeRide?.driver_id &&
      activeRide.drivers?.current_lat != null &&
      activeRide.drivers?.current_lng != null
    ) {
      return {
        id: activeRide.driver_id,
        ride_id: activeRide.id,
        driver_id: activeRide.driver_id,
        lat: activeRide.drivers.current_lat,
        lng: activeRide.drivers.current_lng,
        heading: activeRide.drivers.current_heading || 0,
        speed_kmh: 0,
        eta_seconds: null,
        distance_remaining_meters: null,
        recorded_at: new Date().toISOString(),
      };
    }
    return null;
  }, [driverDocTracking, activeRide]);

  // Derived CustomerProfile for ProfileView preferences
  const customerProfile: CustomerProfile | null = useMemo(() => {
    if (!firebaseUser) return null;
    const raw = (userProfile || {}) as Record<string, any>;
    return {
      id: firebaseUser.uid,
      user_id: firebaseUser.uid,
      preferred_payment_method: (raw.preferred_payment_method as PaymentMethod) || 'upi',
      notification_push_enabled: raw.notification_push_enabled ?? true,
      notification_sms_enabled: raw.notification_sms_enabled ?? true,
      notification_promo_enabled: raw.notification_promo_enabled ?? true,
      fcm_token: raw.fcm_token || null,
      total_rides: rides.length,
      rating_avg: Number(raw.rating_avg || 5.0),
    };
  }, [firebaseUser, userProfile, rides.length]);

  // Merge admin live_notifications broadcasts + per-user notifications
  const mergedNotifications: NotificationRecord[] = useMemo(() => {
    const broadcastItems: NotificationRecord[] = liveAlerts.map((a) => ({
      id: `broadcast:${a.id}`,
      notification_type: 'live_broadcast',
      title: a.title,
      body: a.message,
      deep_link: a.actionLink || null,
      is_read: readBroadcastIds.includes(a.id),
      created_at: a.created_at,
    }));
    return sortByDateDesc([...broadcastItems, ...userNotifications]);
  }, [liveAlerts, userNotifications, readBroadcastIds]);

  const unreadCount = useMemo(
    () => mergedNotifications.filter((n) => !n.is_read).length,
    [mergedNotifications]
  );

  // Active top dismissible Live Alert Banner
  const topBannerAlert = useMemo(() => {
    return liveAlerts.find((a) => !dismissedBannerIds.includes(a.id)) || null;
  }, [liveAlerts, dismissedBannerIds]);

  const persistReadBroadcast = (rawAlertId: string) => {
    setReadBroadcastIds((prev) => {
      if (prev.includes(rawAlertId)) return prev;
      const next = [...prev, rawAlertId];
      try {
        localStorage.setItem('shinecab_read_broadcasts', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleMarkNotificationRead = async (id: string) => {
    if (id.startsWith('broadcast:')) {
      persistReadBroadcast(id.replace('broadcast:', ''));
      return;
    }
    setUserNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    try {
      await updateDoc(doc(db, 'user_notifications', id), { is_read: true });
    } catch {
      // ignore if already removed
    }
  };

  const handleMarkAllRead = async () => {
    // Mark all broadcasts read
    liveAlerts.forEach((a) => persistReadBroadcast(a.id));

    // Mark all user_notifications read
    const unreadUserNotifs = userNotifications.filter((n) => !n.is_read);
    setUserNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    if (unreadUserNotifs.length > 0) {
      try {
        const batch = writeBatch(db);
        unreadUserNotifs.forEach((n) => {
          batch.update(doc(db, 'user_notifications', n.id), { is_read: true });
        });
        await batch.commit();
      } catch {
        // ignore batch failure
      }
    }
  };

  const handleNavigateDeepLink = useCallback((link: string) => {
    const clean = (link || '').trim().toLowerCase();
    if (!clean) return;
    if (clean.includes('chat')) setActiveTab('chat');
    else if (clean.includes('rides')) setActiveTab('rides');
    else if (clean.includes('support')) setActiveTab('support');
    else if (clean.includes('offer')) setActiveTab('offers');
    else if (clean.includes('profile')) setActiveTab('profile');
    else if (clean.includes('notif')) setActiveTab('notifications');
    else setActiveTab('home');
  }, []);

  const handleOnboardingComplete = (target: 'get_started' | 'login') => {
    setAuthInitialMode(target === 'get_started' ? 'signup' : 'login');
    localStorage.setItem('shinecab_onboarding_completed', 'true');
    localStorage.setItem('shinecab_onboarding_v3_seen', 'true');
    setOnboardingDone(true);
  };

  const recentDestinations: LocationPoint[] = useMemo(
    () =>
      rides.slice(0, 5).map((r) => ({
        address: r.drop_address,
        lat: r.drop_lat,
        lng: r.drop_lng,
      })),
    [rides]
  );

  if (!config || !authChecked || showSplash) {
    return (
      <PhoneFrame darkScreen>
        <SplashScreen
          onFinished={() => {
            setShowSplash(false);
          }}
        />
      </PhoneFrame>
    );
  }

  if (shareToken) {
    return (
      <PhoneFrame>
        {gmpQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}
        <SharedTripView
          token={shareToken}
          googleMapsApiKey={config.googleMapsApiKey}
          onExitShare={() => {
            window.history.replaceState({}, '', '/');
            setShareToken(null);
          }}
        />
      </PhoneFrame>
    );
  }

  if (!onboardingDone) {
    return (
      <PhoneFrame darkScreen>
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      </PhoneFrame>
    );
  }

  // Mandatory Login / Sign Up or Profile Completion when not registered yet
  if (!firebaseUser || !userProfile) {
    const needsGooglePhone =
      firebaseUser &&
      userDocLoaded &&
      !userProfile &&
      !firebaseUser.isAnonymous &&
      !firebaseUser.phoneNumber
        ? firebaseUser
        : null;

    return (
      <PhoneFrame topBarDark bottomBarDark={false}>
        <OfflineIndicator />
        <AuthScreen
          initialMode={authInitialMode}
          pendingGoogleUser={needsGooglePhone}
          onAuthenticated={() => {
            setRefreshTick((t) => t + 1);
            setActiveTab('home');
          }}
          onReplayOnboarding={() => setOnboardingDone(false)}
        />
      </PhoneFrame>
    );
  }

  const isFixedViewportTab = activeTab === 'home' || activeTab === 'chat';

  return (
    <PhoneFrame>
      <OfflineIndicator />

      {gmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm shrink-0">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Phone Top App Bar — Compact 52px */}
      <header className="h-[52px] bg-white border-b border-neutral-200 px-3.5 flex items-center justify-between gap-2 shrink-0 z-30">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="min-h-[44px] flex items-center cursor-pointer shrink-0"
          aria-label="SHINE CAB Home"
        >
          <ShineCabLogo size="sm" />
        </button>

        {/* Right Action Icons (44px+ Touch Targets) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            aria-label="Driver Chat and History"
            className={`relative min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center transition cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-[#FFC928] text-[#111111]'
                : 'hover:bg-neutral-100 text-[#111111]'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            {activeRide?.drivers && activeTab !== 'chat' && (
              <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#FFC928] ring-2 ring-white" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            aria-label="Open live notifications"
            className={`relative min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center transition cursor-pointer ${
              activeTab === 'notifications'
                ? 'bg-[#FFC928]/25 text-[#111111]'
                : 'hover:bg-neutral-100 text-[#111111]'
            }`}
          >
            <Bell className="w-5 h-5" />
            {liveConnected && unreadCount === 0 && (
              <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#16A34A]" />
            )}
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FFC928] text-[#111111] font-mono-num text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            aria-label="Open profile"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          >
            <span className="w-8 h-8 rounded-full bg-[#111111] text-[#FFC928] font-display text-xs font-bold flex items-center justify-center overflow-hidden">
              {userProfile?.avatar_url ? (
                <img
                  src={userProfile.avatar_url}
                  alt={userProfile.full_name || 'Customer'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                (userProfile?.full_name || userProfile?.phone || 'U').charAt(0).toUpperCase()
              )}
            </span>
          </button>
        </div>
      </header>

      {/* Dismissible Admin Live Alert Banner (from Firestore live_notifications) */}
      {topBannerAlert && (
        <div
          role="region"
          aria-label="Live alert announcement"
          className="bg-[#111111] text-white px-3 py-2.5 border-b border-neutral-800 flex items-start gap-2.5 shrink-0 z-25"
        >
          <div className="w-7 h-7 rounded-lg bg-[#FFC928] text-[#111111] flex items-center justify-center shrink-0 mt-0.5">
            <Megaphone className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-[#FFC928] truncate">{topBannerAlert.title}</p>
            <p className="text-[11px] text-neutral-200 line-clamp-2 leading-snug">
              {topBannerAlert.message}
            </p>
            {topBannerAlert.actionLink && (
              <div className="mt-1.5">
                {topBannerAlert.actionLink.startsWith('http://') ||
                topBannerAlert.actionLink.startsWith('https://') ? (
                  <a
                    href={topBannerAlert.actionLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => persistReadBroadcast(topBannerAlert.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FFC928] text-[#111111] text-[11px] font-bold hover:brightness-95"
                  >
                    <span>Open Link</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      persistReadBroadcast(topBannerAlert.id);
                      handleNavigateDeepLink(topBannerAlert.actionLink!);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FFC928] text-[#111111] text-[11px] font-bold hover:brightness-95 cursor-pointer"
                  >
                    <span>View Now</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              persistReadBroadcast(topBannerAlert.id);
              setDismissedBannerIds((prev) => [...prev, topBannerAlert.id]);
            }}
            aria-label="Dismiss alert banner"
            className="min-h-[32px] min-w-[32px] flex items-center justify-center text-neutral-400 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Phone Content Stage */}
      <main
        className={`flex-1 min-h-0 flex flex-col relative ${
          isFixedViewportTab ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain'
        }`}
      >
        {activeTab === 'home' && (
          <HomeBookingView
            googleMapsApiKey={config.googleMapsApiKey}
            customerUid={firebaseUser.uid}
            userProfile={userProfile}
            savedAddresses={savedAddresses}
            recentDestinations={recentDestinations}
            coupons={coupons}
            activeRide={activeRide}
            tracking={liveTracking}
            onRideCreated={(ride) => {
              setDismissedRideIds((prev) => prev.filter((id) => id !== ride.id));
            }}
            onRideUpdated={(updated) => {
              if (!updated && activeRide) {
                setDismissedRideIds((prev) => [...prev, activeRide.id]);
              }
            }}
            onTriggerSos={() => setShowSosModal(true)}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onOpenChat={() => setActiveTab('chat')}
            preAppliedCouponCode={preAppliedCoupon}
          />
        )}

        {activeTab === 'rides' && (
          <RidesHistoryView
            rides={rides}
            scheduledRides={scheduledRides}
            loading={dataLoading}
            onRefresh={() => setRefreshTick((t) => t + 1)}
            onCreateSupportForRide={(rideId) => {
              setSupportRideId(rideId);
              setActiveTab('support');
            }}
            onOpenDriverChat={(rideId) => {
              setSelectedChatRideId(rideId);
              setActiveTab('chat');
            }}
          />
        )}

        {activeTab === 'offers' && (
          <OffersView
            coupons={coupons}
            usageHistory={couponUsage}
            loading={dataLoading}
            onApplyCoupon={(code) => {
              setPreAppliedCoupon(code);
              setActiveTab('home');
            }}
          />
        )}

        {activeTab === 'support' && (
          <SupportView
            userId={firebaseUser.uid}
            customerId={firebaseUser.uid}
            tickets={tickets}
            preselectedRideId={supportRideId}
            onTicketsChanged={() => setRefreshTick((t) => t + 1)}
            onTriggerSos={() => setShowSosModal(true)}
          />
        )}

        {activeTab === 'notifications' && (
          <NotificationsView
            notifications={mergedNotifications}
            liveConnected={liveConnected}
            onMarkRead={handleMarkNotificationRead}
            onMarkAllRead={handleMarkAllRead}
            onRefresh={() => setRefreshTick((t) => t + 1)}
            onNavigateDeepLink={handleNavigateDeepLink}
          />
        )}

        {activeTab === 'chat' && (
          <DriverChatView
            rides={rides}
            activeRide={activeRide}
            selectedRideId={selectedChatRideId}
            customerUid={firebaseUser.uid}
            onSelectRide={(id) => setSelectedChatRideId(id)}
            onBack={() => setActiveTab('home')}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileView
            config={config}
            customerUid={firebaseUser.uid}
            userProfile={userProfile}
            customerProfile={customerProfile}
            rides={rides}
            scheduledRides={scheduledRides}
            savedAddresses={savedAddresses}
            emergencyContacts={emergencyContacts}
            payments={payments}
            coupons={coupons}
            couponUsage={couponUsage}
            notifications={mergedNotifications}
            tickets={tickets}
            sosAlerts={sosAlerts}
            activeRide={activeRide}
            onRefresh={() => setRefreshTick((t) => t + 1)}
            onLoggedOut={() => {
              setFirebaseUser(null);
              setActiveTab('home');
            }}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onApplyCoupon={(code) => {
              setPreAppliedCoupon(code);
              setActiveTab('home');
            }}
            onTriggerSos={() => setShowSosModal(true)}
            onReplayOnboarding={() => {
              localStorage.removeItem('shinecab_onboarding_completed');
              localStorage.removeItem('shinecab_onboarding_v3_seen');
              setOnboardingDone(false);
            }}
          />
        )}
      </main>

      {/* Phone 5-Tab Bottom Navigation Bar */}
      <nav
        aria-label="Primary navigation"
        className="shrink-0 z-30 bg-white/95 backdrop-blur-md border-t border-neutral-200 grid grid-cols-5 h-[60px]"
      >
        {(
          [
            { id: 'home', label: 'Home', icon: Home },
            { id: 'rides', label: 'My Rides', icon: Car },
            { id: 'offers', label: 'Offers', icon: Tag },
            { id: 'support', label: 'Support', icon: LifeBuoy },
            { id: 'profile', label: 'Profile', icon: User },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-col items-center justify-center min-h-[44px] cursor-pointer"
            >
              <div
                className={`px-3 py-1 rounded-xl transition-colors ${
                  active ? 'bg-[#FFC928] text-[#111111]' : 'text-[#737373]'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
              </div>
              <span
                className={`text-[10px] font-semibold mt-0.5 whitespace-nowrap ${
                  active ? 'text-[#111111]' : 'text-[#737373]'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {showSosModal && (
        <EmergencySosModal
          rideId={activeRide?.id}
          customerUid={firebaseUser.uid}
          contacts={emergencyContacts}
          onClose={() => setShowSosModal(false)}
        />
      )}
    </PhoneFrame>
  );
}
