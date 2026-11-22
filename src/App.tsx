import React, { useCallback, useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Session, SupabaseClient } from '@supabase/supabase-js';
import { Home, Car, Tag, LifeBuoy, User, Bell, MessageSquare, X } from 'lucide-react';
import { loadAppConfig } from './lib/config';
import { getSupabaseClient } from './lib/supabase';
import {
  AppConfig,
  Coupon,
  CustomerProfile,
  EmergencyContact,
  LocationPoint,
  NotificationRecord,
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

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [showSplash, setShowSplash] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup'>('login');
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [wsLive, setWsLive] = useState(false);
  const [liveToast, setLiveToast] = useState<NotificationRecord | null>(null);
  const [showSosModal, setShowSosModal] = useState(false);
  const [preAppliedCoupon, setPreAppliedCoupon] = useState<string | null>(null);
  const [supportRideId, setSupportRideId] = useState<string | null>(null);
  const [selectedChatRideId, setSelectedChatRideId] = useState<string | null>(null);

  // Domain state loaded strictly from Supabase
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [scheduledRides, setScheduledRides] = useState<ScheduledRide[]>([]);
  const [activeRide, setActiveRide] = useState<RideRecord | null>(null);
  const [liveTracking, setLiveTracking] = useState<RideTrackingPoint | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponUsage, setCouponUsage] = useState<any[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [sosAlerts, setSosAlerts] = useState<SosAlertRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const shareTokenParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('share')
      : null;
  const [shareToken, setShareToken] = useState<string | null>(shareTokenParam);

  // Google Maps Platform Case A Quota Defense listener
  useEffect(() => {
    const handler = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Load runtime config & initialize Supabase auth session
  useEffect(() => {
    let mounted = true;
    loadAppConfig().then(async (cfg) => {
      if (!mounted) return;
      setConfig(cfg);
      const client = getSupabaseClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      setSupabase(client);

      if (!client) {
        setAuthChecked(true);
        return;
      }

      const { data } = await client.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session && localStorage.getItem('shinecab_onboarding_v3_seen') === 'true') {
        setOnboardingDone(true);
      }
      setAuthChecked(true);

      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        if (nextSession) {
          setGuestMode(false);
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    });

    return () => {
      mounted = false;
    };
  }, []);

  const loadCustomerData = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setDataLoading(true);
    try {
      const uid = session.user.id;
      const [{ data: uRow }, { data: cRow }] = await Promise.all([
        supabase.from('users').select('*').eq('id', uid).maybeSingle(),
        supabase.from('customers').select('*').eq('user_id', uid).maybeSingle(),
      ]);

      let resolvedCustomer = cRow as CustomerProfile | null;
      if (!uRow) {
        await supabase.from('users').upsert(
          {
            id: uid,
            phone: session.user.phone || session.user.email || uid,
            email: session.user.email || null,
            role: 'customer',
          },
          { onConflict: 'id' }
        );
      }
      if (!resolvedCustomer) {
        const { data: created } = await supabase
          .from('customers')
          .upsert({ user_id: uid }, { onConflict: 'user_id' })
          .select('*')
          .single();
        resolvedCustomer = created as CustomerProfile | null;
      }

      setUserProfile((uRow as UserProfile | null) || null);
      setCustomerProfile(resolvedCustomer);

      const cid = resolvedCustomer?.id;
      if (!cid) return;

      const [
        ridesRes,
        schedRes,
        addrRes,
        contactsRes,
        couponsRes,
        usageRes,
        payRes,
        notifRes,
        ticketsRes,
        sosRes,
      ] = await Promise.all([
        supabase
          .from('rides')
          .select(
            `*, vehicle_categories(name, slug), drivers(id, rating_avg, current_lat, current_lng, current_heading, users(full_name, avatar_url, phone)), vehicles(id, make, model, color, registration_number), ratings(id, overall_rating, feedback)`
          )
          .eq('customer_id', cid)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('scheduled_rides')
          .select('*, vehicle_categories(name, slug)')
          .eq('customer_id', cid)
          .order('scheduled_for', { ascending: true }),
        supabase.from('saved_addresses').select('*').eq('customer_id', cid).order('created_at'),
        supabase.from('emergency_contacts').select('*').eq('customer_id', cid).order('created_at'),
        supabase
          .from('coupons')
          .select('*')
          .eq('is_active', true)
          .gt('expires_at', new Date().toISOString()),
        supabase
          .from('coupon_usage')
          .select('id, discount_applied, used_at, coupons(code, title)')
          .eq('customer_id', cid)
          .order('used_at', { ascending: false }),
        supabase
          .from('payments')
          .select('*')
          .eq('customer_id', cid)
          .order('created_at', { ascending: false }),
        supabase
          .from('notifications')
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('support_tickets')
          .select('*')
          .eq('customer_id', cid)
          .order('created_at', { ascending: false }),
        supabase
          .from('sos_alerts')
          .select('*')
          .eq('customer_id', cid)
          .order('created_at', { ascending: false }),
      ]);

      const fetchedRides = (ridesRes.data as RideRecord[]) || [];
      setRides(fetchedRides);
      const currentActive =
        fetchedRides.find((r) =>
          [
            'searching_driver',
            'driver_assigned',
            'driver_arriving',
            'driver_reached_pickup',
            'otp_verification',
            'ride_started',
            'ride_completed',
            'payment_pending',
          ].includes(r.status)
        ) || null;
      setActiveRide(currentActive);

      setScheduledRides((schedRes.data as ScheduledRide[]) || []);
      setSavedAddresses((addrRes.data as SavedAddress[]) || []);
      setEmergencyContacts((contactsRes.data as EmergencyContact[]) || []);
      setCoupons((couponsRes.data as Coupon[]) || []);
      setCouponUsage(usageRes.data || []);
      setPayments((payRes.data as PaymentRecord[]) || []);
      setNotifications((notifRes.data as NotificationRecord[]) || []);
      setTickets((ticketsRes.data as SupportTicket[]) || []);
      setSosAlerts((sosRes.data as SosAlertRecord[]) || []);
    } finally {
      setDataLoading(false);
    }
  }, [supabase, session?.user]);

  useEffect(() => {
    if (session?.user) {
      loadCustomerData();
    } else {
      fetch('/api/vehicles/home-summary')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.activeOffers) {
            setCoupons(data.activeOffers as Coupon[]);
          }
        })
        .catch(() => {
          // ignore network errors cleanly
        });
    }
  }, [session?.user, loadCustomerData]);

  // Real-time subscriptions via Supabase Realtime + WebSocket channel
  useEffect(() => {
    if (!supabase || !session?.user || !customerProfile?.id) return;

    const notifChannel = supabase
      .channel(`user-notif-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${session.user.id}`,
        },
        (payload) => {
          const item = payload.new as NotificationRecord;
          setNotifications((prev) =>
            prev.some((existing) => existing.id === item.id) ? prev : [item, ...prev]
          );
          setLiveToast(item);
        }
      )
      .subscribe();

    const ridesChannel = supabase
      .channel(`customer-rides-${customerProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rides',
          filter: `customer_id=eq.${customerProfile.id}`,
        },
        () => {
          loadCustomerData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(ridesChannel);
    };
  }, [supabase, session?.user, customerProfile?.id, loadCustomerData]);

  // Real-time WebSocket stream for live notifications & ride alerts (active for all visitors)
  useEffect(() => {
    if (typeof window === 'undefined') {
      setWsLive(false);
      return;
    }

    const userId = session?.user?.id || null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setWsLive(true);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'updates:live' }));
      if (userId) {
        ws.send(JSON.stringify({ type: 'subscribe', channel: `user:${userId}` }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame?.event === 'notification:new' && frame.payload) {
          const item = frame.payload as NotificationRecord;
          setNotifications((prev) =>
            prev.some((existing) => existing.id === item.id) ? prev : [item, ...prev]
          );
          setLiveToast(item);
        }
      } catch {
        // Ignore malformed WebSocket frames
      }
    };

    ws.onclose = () => {
      setWsLive(false);
    };

    ws.onerror = () => {
      setWsLive(false);
    };

    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe', channel: 'updates:live' }));
          if (userId) {
            ws.send(JSON.stringify({ type: 'unsubscribe', channel: `user:${userId}` }));
          }
        }
        ws.close();
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [session?.user?.id]);

  // Auto-dismiss live notification toast after 6 seconds
  useEffect(() => {
    if (!liveToast) return;
    const timer = window.setTimeout(() => setLiveToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [liveToast]);

  // Live driver GPS tracking channel for the active ride
  useEffect(() => {
    if (!supabase || !activeRide?.id) {
      setLiveTracking(null);
      return;
    }

    const trackingChannel = supabase
      .channel(`ride-track-${activeRide.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_tracking',
          filter: `ride_id=eq.${activeRide.id}`,
        },
        (payload) => {
          setLiveTracking(payload.new as RideTrackingPoint);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(trackingChannel);
    };
  }, [supabase, activeRide?.id]);

  const handleMarkNotificationRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    if (supabase && session?.user) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    if (supabase && session?.user) {
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', session.user.id);
    }
  };

  const handleOnboardingComplete = (target: 'get_started' | 'login') => {
    setAuthInitialMode(target === 'get_started' ? 'signup' : 'login');
    localStorage.setItem('shinecab_onboarding_completed', 'true');
    localStorage.setItem('shinecab_onboarding_v3_seen', 'true');
    setOnboardingDone(true);
  };

  const openAuthScreen = (mode: 'login' | 'signup' = 'login') => {
    setAuthInitialMode(mode);
    setGuestMode(false);
  };

  const recentDestinations: LocationPoint[] = rides
    .slice(0, 5)
    .map((r) => ({
      address: r.drop_address,
      lat: r.drop_lat,
      lng: r.drop_lng,
    }));

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const quotaBanner = quotaExceeded ? (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-3 py-2 text-[11px] text-center shrink-0 z-50">
      <span>
        Google Maps Platform quota reached. If you are the app owner, visit{' '}
        <a
          href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-amber-950"
        >
          maps developer site
        </a>
        .
      </span>
    </div>
  ) : null;

  if (!config || !authChecked) {
    return (
      <PhoneFrame darkScreen>
        {quotaBanner}
        <SplashScreen onFinished={() => {}} />
      </PhoneFrame>
    );
  }

  if (showSplash) {
    return (
      <PhoneFrame darkScreen>
        {quotaBanner}
        <SplashScreen onFinished={() => setShowSplash(false)} />
      </PhoneFrame>
    );
  }

  if (shareToken) {
    return (
      <PhoneFrame>
        {quotaBanner}
        <SharedTripView
          token={shareToken}
          config={config}
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
        {quotaBanner}
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      </PhoneFrame>
    );
  }

  if (!session && !guestMode) {
    return (
      <PhoneFrame>
        {quotaBanner}
        <OfflineIndicator />
        <AuthScreen
          config={config}
          supabase={supabase}
          initialMode={authInitialMode}
          onAuthenticated={() => {
            setGuestMode(false);
            loadCustomerData();
          }}
          onSkipToHome={() => {
            setGuestMode(true);
            setActiveTab('home');
          }}
          onReplayOnboarding={() => setOnboardingDone(false)}
        />
      </PhoneFrame>
    );
  }

  const renderGuestAuthPrompt = (title: string, subtitle: string) => (
    <div className="flex-1 flex items-center justify-center p-5">
      <div className="w-full bg-white border border-neutral-200 rounded-3xl p-6 text-center space-y-5 shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-[#FFC928] text-[#111111] flex items-center justify-center mx-auto">
          <User className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="font-display text-lg font-bold text-[#111111]">{title}</h2>
          <p className="text-xs text-[#737373] leading-relaxed">{subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => openAuthScreen('login')}
            className="min-h-[44px] rounded-xl bg-[#FFC928] text-[#111111] font-semibold text-sm hover:brightness-95 transition cursor-pointer"
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => openAuthScreen('signup')}
            className="min-h-[44px] rounded-xl bg-[#111111] text-white font-semibold text-sm hover:bg-neutral-800 transition cursor-pointer"
          >
            Sign Up
          </button>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="text-xs font-semibold text-[#737373] hover:text-[#111111] min-h-[40px] cursor-pointer"
        >
          Back to Home Map
        </button>
      </div>
    </div>
  );

  const isFixedViewportTab = activeTab === 'home' || activeTab === 'chat';

  const mainShell = (
    <PhoneFrame>
      {quotaBanner}
      <OfflineIndicator />

      {/* Phone Top App Bar — Compact 52px */}
      <header className="h-[54px] bg-white border-b border-neutral-200 px-3.5 flex items-center justify-between gap-2 shrink-0 z-30">
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
            {wsLive && unreadCount === 0 && (
              <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#16A34A]" />
            )}
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FFC928] text-[#111111] font-mono-num text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {session ? (
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
          ) : (
            <button
              type="button"
              onClick={() => openAuthScreen('login')}
              className="min-h-[38px] px-3 rounded-xl bg-[#FFC928] text-[#111111] text-xs font-bold hover:brightness-95 transition cursor-pointer whitespace-nowrap"
            >
              Login
            </button>
          )}
        </div>
      </header>

      {/* Main Phone Content Stage */}
      <main
        className={`flex-1 min-h-0 flex flex-col relative ${
          isFixedViewportTab ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain'
        }`}
      >
        {activeTab === 'home' && (
          <HomeBookingView
            config={config}
            supabase={supabase}
            accessToken={session?.access_token ?? null}
            customerId={customerProfile?.id || null}
            savedAddresses={savedAddresses}
            recentDestinations={recentDestinations}
            activeRide={activeRide}
            tracking={liveTracking}
            onRideCreated={(ride) => {
              setActiveRide(ride);
              loadCustomerData();
            }}
            onRideUpdated={(updated) => {
              setActiveRide(updated);
              loadCustomerData();
            }}
            onTriggerSos={() => {
              if (!session) {
                openAuthScreen('login');
                return;
              }
              setShowSosModal(true);
            }}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onOpenChat={() => setActiveTab('chat')}
            onRequireAuth={(mode = 'login') => openAuthScreen(mode)}
            preAppliedCouponCode={preAppliedCoupon}
          />
        )}

        {activeTab === 'rides' && (
          <RidesHistoryView
            rides={rides}
            scheduledRides={scheduledRides}
            loading={dataLoading}
            supabase={supabase}
            onRefresh={loadCustomerData}
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
            supabase={supabase}
            userId={session?.user?.id || null}
            customerId={customerProfile?.id || null}
            tickets={tickets}
            preselectedRideId={supportRideId}
            onTicketsChanged={loadCustomerData}
            onTriggerSos={() => (session ? setShowSosModal(true) : openAuthScreen('login'))}
          />
        )}

        {activeTab === 'notifications' && (
          <NotificationsView
            notifications={notifications}
            wsConnected={wsLive || Boolean(supabase && customerProfile?.id)}
            isAuthenticated={Boolean(session)}
            onMarkRead={handleMarkNotificationRead}
            onMarkAllRead={handleMarkAllRead}
            onRefresh={loadCustomerData}
            onRequireAuth={() => openAuthScreen('login')}
            onNavigateDeepLink={(link) => {
              if (link.includes('chat')) setActiveTab('chat');
              else if (link.includes('rides')) setActiveTab('rides');
              else if (link.includes('support')) setActiveTab('support');
              else if (link.includes('offers')) setActiveTab('offers');
              else setActiveTab('home');
            }}
          />
        )}

        {activeTab === 'chat' && (
          <DriverChatView
            rides={rides}
            activeRide={activeRide}
            selectedRideId={selectedChatRideId}
            accessToken={session?.access_token ?? null}
            supabase={supabase}
            onSelectRide={(id) => setSelectedChatRideId(id)}
            onBack={() => setActiveTab('home')}
            onRequireAuth={() => openAuthScreen('login')}
          />
        )}

        {activeTab === 'profile' &&
          (session ? (
            <ProfileView
              config={config}
              supabase={supabase}
              accessToken={session.access_token}
              userProfile={userProfile}
              customerProfile={customerProfile}
              rides={rides}
              scheduledRides={scheduledRides}
              savedAddresses={savedAddresses}
              emergencyContacts={emergencyContacts}
              payments={payments}
              coupons={coupons}
              couponUsage={couponUsage}
              notifications={notifications}
              tickets={tickets}
              sosAlerts={sosAlerts}
              activeRide={activeRide}
              onRefresh={loadCustomerData}
              onLoggedOut={() => {
                setSession(null);
                setGuestMode(false);
              }}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onApplyCoupon={(code) => {
                setPreAppliedCoupon(code);
                setActiveTab('home');
              }}
              onTriggerSos={() => setShowSosModal(true)}
              onReplayOnboarding={() => {
                localStorage.removeItem('shinecab_onboarding_completed');
                setOnboardingDone(false);
              }}
            />
          ) : (
            renderGuestAuthPrompt(
              'Sign in or create your account',
              'Manage your profile, saved Home & Office addresses, emergency contacts, and payment history.'
            )
          ))}
      </main>

      {/* Phone 5-Tab Bottom Navigation Bar (Docked Flex Anchor — Zero Overlap) */}
      <nav
        aria-label="Primary navigation"
        className="shrink-0 z-30 bg-white/95 backdrop-blur-md border-t border-neutral-200 grid grid-cols-5 h-[60px] pb-safe"
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

      {liveToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-[58px] right-3 left-3 z-40 bg-[#111111] text-white rounded-2xl p-3.5 shadow-xl border border-neutral-800 flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-xl bg-[#FFC928] text-[#111111] flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-white truncate">{liveToast.title}</p>
            <p className="text-[11px] text-neutral-300 mt-0.5 line-clamp-2">{liveToast.body}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('notifications');
                  setLiveToast(null);
                }}
                className="text-[11px] font-semibold text-[#FFC928] hover:underline cursor-pointer"
              >
                Open Notifications
              </button>
              <button
                type="button"
                onClick={() => setLiveToast(null)}
                className="text-[11px] text-neutral-400 hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLiveToast(null)}
            aria-label="Close live notification"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-neutral-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showSosModal && session && (
        <EmergencySosModal
          rideId={activeRide?.id}
          accessToken={session.access_token}
          contacts={emergencyContacts}
          onClose={() => setShowSosModal(false)}
        />
      )}
    </PhoneFrame>
  );

  if (config.services.maps && config.googleMapsApiKey) {
    return (
      <APIProvider apiKey={config.googleMapsApiKey} language="en" region="IN">
        {mainShell}
      </APIProvider>
    );
  }

  return mainShell;
}
