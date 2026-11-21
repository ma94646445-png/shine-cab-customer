import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  MapPin,
  Shield,
  CreditCard,
  Bell,
  LogOut,
  Trash2,
  Plus,
  Receipt,
  ChevronRight,
  ArrowLeft,
  Star,
  Car,
  Tag,
  LifeBuoy,
  FileText,
  SlidersHorizontal,
  PhoneCall,
  Camera,
  CheckCircle2,
  Download,
  AlertTriangle,
  MessageSquare,
  CalendarClock,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  AppConfig,
  Coupon,
  CustomerProfile,
  EmergencyContact,
  NotificationRecord,
  PaymentMethod,
  PaymentRecord,
  RideRecord,
  SavedAddress,
  ScheduledRide,
  SosAlertRecord,
  SupportTicket,
  UserProfile,
} from '../types/shinecab';
import { PWAInstallButton } from './PWAInstallBanner';
import { registerFcmPushNotifications } from '../lib/fcm';
import { ProfileLegalSection } from './ProfileLegalSection';

export type ProfileSection =
  | 'overview'
  | 'personal'
  | 'payments'
  | 'addresses'
  | 'safety'
  | 'rewards'
  | 'notifications'
  | 'preferences'
  | 'legal';

interface ProfileViewProps {
  config: AppConfig;
  supabase: SupabaseClient | null;
  accessToken: string;
  userProfile: UserProfile | null;
  customerProfile: CustomerProfile | null;
  rides: RideRecord[];
  scheduledRides: ScheduledRide[];
  savedAddresses: SavedAddress[];
  emergencyContacts: EmergencyContact[];
  payments: PaymentRecord[];
  coupons: Coupon[];
  couponUsage: any[];
  notifications: NotificationRecord[];
  tickets: SupportTicket[];
  sosAlerts: SosAlertRecord[];
  activeRide: RideRecord | null;
  onRefresh: () => void;
  onLoggedOut: () => void;
  onNavigateTab: (tab: 'home' | 'rides' | 'offers' | 'notifications' | 'support' | 'chat') => void;
  onApplyCoupon: (code: string) => void;
  onTriggerSos: () => void;
  onReplayOnboarding: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  config,
  supabase,
  accessToken,
  userProfile,
  customerProfile,
  rides,
  scheduledRides,
  savedAddresses,
  emergencyContacts,
  payments,
  coupons,
  couponUsage,
  notifications,
  tickets,
  sosAlerts,
  activeRide,
  onRefresh,
  onLoggedOut,
  onNavigateTab,
  onApplyCoupon,
  onTriggerSos,
  onReplayOnboarding,
}) => {
  const [section, setSection] = useState<ProfileSection>('overview');

  // Personal Profile State
  const [fullName, setFullName] = useState(userProfile?.full_name || '');
  const [email, setEmail] = useState(userProfile?.email || '');
  const [avatarUrl, setAvatarUrl] = useState<string>(userProfile?.avatar_url || '');
  const [language, setLanguage] = useState(userProfile?.language_preference || 'en');
  const [preferredMethod, setPreferredMethod] = useState<PaymentMethod>(
    customerProfile?.preferred_payment_method || 'upi'
  );
  const [pushEnabled, setPushEnabled] = useState(
    customerProfile?.notification_push_enabled ?? true
  );
  const [smsEnabled, setSmsEnabled] = useState(
    customerProfile?.notification_sms_enabled ?? true
  );
  const [promoEnabled, setPromoEnabled] = useState(
    customerProfile?.notification_promo_enabled ?? true
  );
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Saved Address form state
  const [addrLabel, setAddrLabel] = useState('');
  const [addrType, setAddrType] = useState<'home' | 'office' | 'other'>('home');
  const [addrLine, setAddrLine] = useState('');
  const [savingAddr, setSavingAddr] = useState(false);

  // Emergency Contact form state
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRel, setContactRel] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  useEffect(() => {
    setFullName(userProfile?.full_name || '');
    setEmail(userProfile?.email || '');
    setAvatarUrl(userProfile?.avatar_url || '');
    setLanguage(userProfile?.language_preference || 'en');
  }, [userProfile]);

  useEffect(() => {
    if (!customerProfile) return;
    setPreferredMethod(customerProfile.preferred_payment_method || 'upi');
    setPushEnabled(customerProfile.notification_push_enabled ?? true);
    setSmsEnabled(customerProfile.notification_sms_enabled ?? true);
    setPromoEnabled(customerProfile.notification_promo_enabled ?? true);
  }, [customerProfile]);

  // Derived strictly from real records
  const totalCompletedRides = useMemo(
    () => rides.filter((r) => r.status === 'payment_completed' || r.status === 'ride_completed').length,
    [rides]
  );

  const totalSpent = useMemo(() => {
    return payments
      .filter((p) => p.status === 'captured' || p.status === 'paid')
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
  }, [payments]);

  const totalSavings = useMemo(
    () => couponUsage.reduce((acc, u) => acc + Number(u.discount_applied || 0), 0),
    [couponUsage]
  );

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const openTicketsCount = useMemo(
    () => tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length,
    [tickets]
  );

  const upcomingScheduledCount = useMemo(
    () => scheduledRides.filter((s) => s.status === 'scheduled' || s.status === 'dispatching').length,
    [scheduledRides]
  );

  const showNotice = (text: string, type: 'ok' | 'err' = 'ok') => {
    setStatusMsg({ type, text });
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showNotice('Please select a valid image file (PNG, JPG, WebP).', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 256;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          setAvatarUrl(dataUrl);
          showNotice('Photo ready. Tap "Save Personal Details" to update your profile.');
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !userProfile || !customerProfile) {
      showNotice('Database session is required to update your profile.', 'err');
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    try {
      const { error: uErr } = await supabase
        .from('users')
        .update({
          full_name: fullName.trim() || null,
          email: email.trim() || null,
          avatar_url: avatarUrl.trim() || null,
          language_preference: language,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userProfile.id);

      if (uErr) throw uErr;

      const { error: cErr } = await supabase
        .from('customers')
        .update({
          preferred_payment_method: preferredMethod,
          notification_push_enabled: pushEnabled,
          notification_sms_enabled: smsEnabled,
          notification_promo_enabled: promoEnabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerProfile.id);

      if (cErr) throw cErr;

      showNotice('Profile and preferences saved.');
      onRefresh();
    } catch (err: any) {
      showNotice(err?.message || 'Unable to save profile updates.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateNotificationPrefs = async () => {
    if (!supabase || !customerProfile) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      const { error } = await supabase
        .from('customers')
        .update({
          notification_push_enabled: pushEnabled,
          notification_sms_enabled: smsEnabled,
          notification_promo_enabled: promoEnabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerProfile.id);
      if (error) throw error;
      showNotice('Notification preferences updated.');
      onRefresh();
    } catch (err: any) {
      showNotice(err?.message || 'Could not update notification preferences.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePreferredPayment = async (method: PaymentMethod) => {
    setPreferredMethod(method);
    if (!supabase || !customerProfile) return;
    const { error } = await supabase
      .from('customers')
      .update({
        preferred_payment_method: method,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerProfile.id);
    if (error) {
      showNotice(error.message, 'err');
    } else {
      showNotice(`Default payment method set to ${method.toUpperCase()}.`);
      onRefresh();
    }
  };

  const handleEnableFcm = async () => {
    if (!supabase || !customerProfile) return;
    const token = await registerFcmPushNotifications(config, () => {
      onRefresh();
    });
    if (!token) {
      showNotice(
        'Push notifications require Firebase Cloud Messaging configuration and browser permission.',
        'err'
      );
      return;
    }
    await supabase.from('customers').update({ fcm_token: token }).eq('id', customerProfile.id);
    showNotice('Push notifications enabled on this device.');
    onRefresh();
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !customerProfile || !addrLine.trim()) return;
    setSavingAddr(true);
    setStatusMsg(null);
    let lat = 0;
    let lng = 0;
    try {
      const geoRes = await fetch(`/api/maps/geocode?address=${encodeURIComponent(addrLine.trim())}`);
      if (geoRes.ok) {
        const geo = await geoRes.json();
        const loc = geo.results?.[0]?.geometry?.location;
        if (loc) {
          lat = loc.lat;
          lng = loc.lng;
        }
      }
    } catch {
      // handled below
    }

    if (!lat && !lng) {
      setSavingAddr(false);
      showNotice(
        'Could not verify coordinates for that address. Ensure Google Maps Geocoding is available.',
        'err'
      );
      return;
    }

    const { error } = await supabase.from('saved_addresses').insert({
      customer_id: customerProfile.id,
      label:
        addrLabel.trim() || (addrType === 'home' ? 'Home' : addrType === 'office' ? 'Office' : 'Saved'),
      address_type: addrType,
      address_line: addrLine.trim(),
      lat,
      lng,
    });

    setSavingAddr(false);
    if (error) {
      showNotice(error.message, 'err');
      return;
    }
    setAddrLabel('');
    setAddrLine('');
    showNotice('Address verified and saved.');
    onRefresh();
  };

  const handleDeleteAddress = async (id: string) => {
    if (!supabase) return;
    await supabase.from('saved_addresses').delete().eq('id', id);
    showNotice('Saved address removed.');
    onRefresh();
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !customerProfile || !contactName.trim() || !contactPhone.trim()) return;
    setSavingContact(true);
    const { error } = await supabase.from('emergency_contacts').insert({
      customer_id: customerProfile.id,
      name: contactName.trim(),
      phone: contactPhone.trim(),
      relationship: contactRel.trim() || null,
      is_primary: emergencyContacts.length === 0,
    });
    setSavingContact(false);
    if (error) {
      showNotice(error.message, 'err');
      return;
    }
    setContactName('');
    setContactPhone('');
    setContactRel('');
    showNotice('Emergency contact added.');
    onRefresh();
  };

  const handleSetPrimaryContact = async (contactId: string) => {
    if (!supabase || !customerProfile) return;
    await supabase
      .from('emergency_contacts')
      .update({ is_primary: false })
      .eq('customer_id', customerProfile.id);
    await supabase
      .from('emergency_contacts')
      .update({ is_primary: true })
      .eq('id', contactId);
    showNotice('Primary emergency contact updated.');
    onRefresh();
  };

  const handleDeleteContact = async (id: string) => {
    if (!supabase) return;
    await supabase.from('emergency_contacts').delete().eq('id', id);
    showNotice('Emergency contact deleted.');
    onRefresh();
  };

  const handleRequestRefund = async (paymentId: string) => {
    const res = await fetch(`/api/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ reason: 'Customer requested refund' }),
    });
    const data = await res.json();
    showNotice(
      res.ok ? 'Refund request submitted.' : data.error || 'Refund request failed.',
      res.ok ? 'ok' : 'err'
    );
    onRefresh();
  };

  const handleDownloadReceipt = (payment: PaymentRecord) => {
    const relatedRide = rides.find((r) => r.id === payment.ride_id);
    const lines = [
      'SHINE CAB — OFFICIAL PAYMENT RECEIPT',
      '====================================',
      `Receipt No: ${payment.receipt_number || payment.id}`,
      `Status: ${payment.status.toUpperCase()}`,
      `Amount: INR ${Number(payment.amount).toFixed(2)} (${payment.currency})`,
      `Payment Method: ${payment.payment_method.toUpperCase()} (${payment.provider.toUpperCase()})`,
      payment.razorpay_payment_id ? `Transaction ID: ${payment.razorpay_payment_id}` : '',
      `Date: ${new Date(payment.paid_at || payment.created_at).toLocaleString()}`,
      relatedRide ? `Ride Code: ${relatedRide.ride_code}` : '',
      relatedRide ? `Pickup: ${relatedRide.pickup_address}` : '',
      relatedRide ? `Drop: ${relatedRide.drop_address}` : '',
      '====================================',
      `Customer: ${userProfile?.full_name || userProfile?.phone || 'Customer'}`,
    ]
      .filter(Boolean)
      .join('\n');

    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${payment.receipt_number || `receipt-${payment.id.slice(0, 8)}`}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      user: userProfile,
      customer: customerProfile,
      savedAddresses,
      emergencyContacts,
      rides,
      scheduledRides,
      payments,
      sosAlerts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shinecab-account-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice('Account data JSON downloaded.');
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    onLoggedOut();
  };

  const handleDeleteAccount = async () => {
    const res = await fetch('/api/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      if (supabase) await supabase.auth.signOut();
      onLoggedOut();
    } else {
      const data = await res.json();
      showNotice(data.error || 'Unable to delete account.', 'err');
    }
  };

  const menuItems: {
    id: ProfileSection;
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  }[] = [
    {
      id: 'personal',
      title: 'Personal Details & Photo',
      subtitle: userProfile?.email || userProfile?.phone || 'Name, email, photo & language',
      icon: User,
    },
    {
      id: 'payments',
      title: 'Payments, Methods & Receipts',
      subtitle: `Default: ${preferredMethod.toUpperCase()} · ${payments.length} transactions`,
      icon: CreditCard,
      badge: payments.length > 0 ? `${payments.length}` : undefined,
    },
    {
      id: 'addresses',
      title: 'Saved Places (Home & Office)',
      subtitle: `${savedAddresses.length} saved destinations`,
      icon: MapPin,
      badge: savedAddresses.length > 0 ? `${savedAddresses.length}` : undefined,
    },
    {
      id: 'safety',
      title: 'Safety Center, SOS & Contacts',
      subtitle: `${emergencyContacts.length} trusted contacts · ${sosAlerts.length} SOS logs`,
      icon: Shield,
    },
    {
      id: 'rewards',
      title: 'Offers, Coupons & Savings',
      subtitle: `${coupons.length} active offers · ₹${totalSavings.toFixed(0)} saved`,
      icon: Tag,
      badge: coupons.length > 0 ? `${coupons.length}` : undefined,
    },
    {
      id: 'notifications',
      title: 'Notification & Push Settings',
      subtitle: `${unreadNotifications} unread alerts · FCM & SMS controls`,
      icon: Bell,
      badge: unreadNotifications > 0 ? `${unreadNotifications}` : undefined,
    },
    {
      id: 'preferences',
      title: 'App Preferences & Support',
      subtitle: `${openTicketsCount} open tickets · PWA & onboarding`,
      icon: SlidersHorizontal,
    },
    {
      id: 'legal',
      title: 'Legal, Privacy & Account Security',
      subtitle: 'Privacy Policy, Terms, Data Export & Account Deletion',
      icon: FileText,
    },
  ];

  const activeMenuTitle = menuItems.find((m) => m.id === section)?.title || 'Account Hub';

  return (
    <div className="w-full p-4 pb-6 space-y-4">
      {/* Compact Phone Top Header */}
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {section !== 'overview' && (
            <button
              type="button"
              onClick={() => setSection('overview')}
              aria-label="Back to profile overview"
              className="min-h-[44px] min-w-[44px] rounded-xl border border-neutral-200 bg-white flex items-center justify-center hover:bg-neutral-50 active:scale-[0.98] shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 text-[#111111]" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-[#111111] truncate">
              {section === 'overview' ? 'My Account' : activeMenuTitle}
            </h1>
            <p className="text-[11px] text-[#737373] truncate">
              {section === 'overview'
                ? 'Rides, safety, saved places & security'
                : 'Tap back arrow for account menu'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="min-h-[44px] px-3 rounded-xl border border-neutral-300 bg-white text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 hover:bg-neutral-50 shrink-0 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </div>

      {statusMsg && (
        <div
          className={`rounded-2xl px-3.5 py-3 text-xs font-medium flex items-center justify-between gap-3 ${
            statusMsg.type === 'err'
              ? 'bg-red-50 text-red-900 border border-red-200'
              : 'bg-[#111111] text-[#FFC928]'
          }`}
        >
          <span className="min-w-0 flex-1">{statusMsg.text}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-[11px] underline cursor-pointer shrink-0 min-h-[32px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* OVERVIEW HUB */}
      {section === 'overview' && (
        <div className="space-y-4">
          {/* Hero Profile Card */}
          <div className="bg-[#111111] text-white rounded-3xl p-4 space-y-3.5 shadow-sm">
            <div className="flex items-center gap-3.5">
              <div className="relative w-14 h-14 rounded-2xl bg-[#FFC928] text-[#111111] font-display text-lg font-bold flex items-center justify-center overflow-hidden shrink-0">
                {avatarUrl || userProfile?.avatar_url ? (
                  <img
                    src={avatarUrl || userProfile?.avatar_url || ''}
                    alt={userProfile?.full_name || 'Customer'}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (userProfile?.full_name || userProfile?.phone || 'U').charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-bold truncate">
                  {userProfile?.full_name || 'SHINE CAB Rider'}
                </p>
                <p className="text-xs text-neutral-300 font-mono-num truncate">
                  {userProfile?.phone || '—'}
                </p>
                {userProfile?.email && (
                  <p className="text-[11px] text-neutral-400 truncate">{userProfile.email}</p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 font-mono-num font-semibold text-[#FFC928]">
                    <Star className="w-3.5 h-3.5 fill-[#FFC928] text-[#FFC928]" />
                    {Number(customerProfile?.rating_avg || 5).toFixed(2)}
                  </span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-300 font-mono-num">
                    {rides.length} {rides.length === 1 ? 'ride' : 'rides'}
                  </span>
                </div>
              </div>
            </div>

            {activeRide && (
              <div className="rounded-2xl bg-neutral-900 border border-neutral-800 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-[#FFC928] font-semibold">
                    Active Ride · {activeRide.ride_code}
                  </p>
                  <p className="text-xs text-neutral-200 truncate">{activeRide.drop_address}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab(activeRide.drivers ? 'chat' : 'home')}
                  className="min-h-[36px] px-3 rounded-xl bg-[#FFC928] text-[#111111] text-[11px] font-bold shrink-0 cursor-pointer"
                >
                  {activeRide.drivers ? 'Chat' : 'Track'}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSection('personal')}
                className="flex-1 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition cursor-pointer"
              >
                Edit Profile & Photo
              </button>
              <PWAInstallButton compact />
            </div>
          </div>

          {/* Real Metrics 2x2 Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-white rounded-2xl border border-neutral-200 p-3.5">
              <p className="text-[11px] text-[#737373] font-medium">Completed Rides</p>
              <p className="font-display text-lg font-bold text-[#111111] font-mono-num mt-0.5">
                {totalCompletedRides}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-neutral-200 p-3.5">
              <p className="text-[11px] text-[#737373] font-medium">Total Spent</p>
              <p className="font-display text-lg font-bold text-[#111111] font-mono-num mt-0.5">
                ₹{totalSpent.toFixed(0)}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-neutral-200 p-3.5">
              <p className="text-[11px] text-[#737373] font-medium">Promo Savings</p>
              <p className="font-display text-lg font-bold text-[#16A34A] font-mono-num mt-0.5">
                ₹{totalSavings.toFixed(0)}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-neutral-200 p-3.5">
              <p className="text-[11px] text-[#737373] font-medium">Scheduled Trips</p>
              <p className="font-display text-lg font-bold text-[#111111] font-mono-num mt-0.5">
                {upcomingScheduledCount}
              </p>
            </div>
          </div>

          {/* Account Menu Directory */}
          <nav
            aria-label="Profile pages"
            className="bg-white rounded-3xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden"
          >
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className="w-full min-h-[58px] px-4 py-3 flex items-center gap-3 text-left hover:bg-neutral-50 active:bg-neutral-100 transition cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-neutral-100 text-[#111111] flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[#111111] truncate">{item.title}</p>
                    <p className="text-[11px] text-[#737373] truncate">{item.subtitle}</p>
                  </div>
                  {item.badge && (
                    <span className="px-2 py-0.5 rounded-md bg-neutral-100 font-mono-num text-[11px] font-bold text-[#111111]">
                      {item.badge}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />
                </button>
              );
            })}
          </nav>

          {/* Quick Cross-App Shortcuts */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3">
            <h2 className="font-display text-sm font-bold text-[#111111]">Quick Shortcuts</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onNavigateTab('rides')}
                className="min-h-[68px] p-3 rounded-2xl border border-neutral-200 hover:border-[#111111] text-left flex flex-col justify-between transition cursor-pointer"
              >
                <Car className="w-4 h-4 text-[#111111]" />
                <div>
                  <p className="text-xs font-bold text-[#111111]">My Rides</p>
                  <p className="text-[11px] text-[#737373] font-mono-num">
                    {rides.length} total trips
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('notifications')}
                className="min-h-[68px] p-3 rounded-2xl border border-neutral-200 hover:border-[#111111] text-left flex flex-col justify-between transition cursor-pointer"
              >
                <Bell className="w-4 h-4 text-[#111111]" />
                <div>
                  <p className="text-xs font-bold text-[#111111]">Live Alerts</p>
                  <p className="text-[11px] text-[#737373] font-mono-num">
                    {unreadNotifications} unread
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('offers')}
                className="min-h-[68px] p-3 rounded-2xl border border-neutral-200 hover:border-[#111111] text-left flex flex-col justify-between transition cursor-pointer"
              >
                <Tag className="w-4 h-4 text-[#111111]" />
                <div>
                  <p className="text-xs font-bold text-[#111111]">Offers & Promos</p>
                  <p className="text-[11px] text-[#737373] font-mono-num">
                    {coupons.length} available
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab('support')}
                className="min-h-[68px] p-3 rounded-2xl border border-neutral-200 hover:border-[#111111] text-left flex flex-col justify-between transition cursor-pointer"
              >
                <LifeBuoy className="w-4 h-4 text-[#111111]" />
                <div>
                  <p className="text-xs font-bold text-[#111111]">Shine Support</p>
                  <p className="text-[11px] text-[#737373] font-mono-num">
                    {openTicketsCount} open tickets
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={onTriggerSos}
                className="min-h-[68px] p-3 rounded-2xl border border-red-200 bg-red-50/70 hover:bg-red-50 text-left flex flex-col justify-between transition cursor-pointer"
              >
                <Shield className="w-4 h-4 text-[#DC2626]" />
                <div>
                  <p className="text-xs font-bold text-[#DC2626]">24x7 Safety SOS</p>
                  <p className="text-[11px] text-red-700 font-mono-num">
                    {emergencyContacts.length} trusted contacts
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab(activeRide?.drivers ? 'chat' : 'home')}
                className="min-h-[68px] p-3 rounded-2xl border border-neutral-200 bg-[#FFC928]/15 hover:bg-[#FFC928]/25 text-left flex flex-col justify-between transition cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-[#111111]" />
                <div>
                  <p className="text-xs font-bold text-[#111111]">
                    {activeRide?.drivers ? 'Driver Chat' : 'Book a Ride'}
                  </p>
                  <p className="text-[11px] text-[#737373]">
                    {activeRide?.drivers ? 'Message & call captain' : 'Open pickup map'}
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Recent Activity Snapshot */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-[#111111]">
                Recent Transactions & Trips
              </h2>
              <button
                type="button"
                onClick={() => setSection('payments')}
                className="min-h-[36px] text-xs font-semibold text-[#111111] underline underline-offset-4 cursor-pointer"
              >
                View all
              </button>
            </div>
            {rides.length === 0 && payments.length === 0 ? (
              <p className="text-xs text-[#737373]">
                No completed trips or payments recorded yet. Book your first Bike, Auto, or Cab
                ride from Home.
              </p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {rides.slice(0, 3).map((r) => (
                  <div key={r.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#111111] truncate">
                        {r.ride_code} · {r.drop_address}
                      </p>
                      <p className="text-[11px] text-[#737373]">
                        {new Date(r.created_at).toLocaleDateString()} ·{' '}
                        {r.status.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <span className="font-mono-num font-bold text-[#111111] shrink-0">
                      ₹{Number(r.total_fare || 0).toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-PAGES */}
      {section !== 'overview' && (
        <section className="space-y-4">
          {/* 1. PERSONAL DETAILS & PHOTO */}
          {section === 'personal' && (
            <form
              onSubmit={handleSaveProfile}
              className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-4"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-16 h-16 rounded-2xl bg-[#111111] text-[#FFC928] font-display text-xl font-bold flex items-center justify-center overflow-hidden shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={fullName || 'Customer'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    (fullName || userProfile?.phone || 'U').charAt(0).toUpperCase()
                  )}
                </div>
                <div className="space-y-1.5 min-w-0 flex-1">
                  <p className="text-xs font-bold text-[#111111]">Profile Photo</p>
                  <p className="text-[11px] text-[#737373] font-mono-num truncate">
                    Phone: <strong className="text-[#111111]">{userProfile?.phone || '—'}</strong>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[40px] px-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Upload Photo</span>
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarUrl('')}
                        className="min-h-[40px] px-3 rounded-xl border border-neutral-200 text-xs font-semibold text-[#DC2626] hover:bg-red-50 cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block space-y-1 text-xs font-semibold text-neutral-700">
                  <span>Full Name</span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full h-11 rounded-xl border border-neutral-300 px-3 text-xs focus:outline-none focus:border-[#111111]"
                  />
                </label>

                <label className="block space-y-1 text-xs font-semibold text-neutral-700">
                  <span>Email Address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 rounded-xl border border-neutral-300 px-3 text-xs focus:outline-none focus:border-[#111111]"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1 text-xs font-semibold text-neutral-700">
                    <span>Default Payment</span>
                    <select
                      value={preferredMethod}
                      onChange={(e) => setPreferredMethod(e.target.value as PaymentMethod)}
                      className="w-full h-11 rounded-xl border border-neutral-300 px-3 text-xs bg-white"
                    >
                      <option value="upi">UPI</option>
                      <option value="online">Card / Online</option>
                      <option value="cash">Cash</option>
                    </select>
                  </label>

                  <label className="block space-y-1 text-xs font-semibold text-neutral-700">
                    <span>App Language</span>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full h-11 rounded-xl border border-neutral-300 px-3 text-xs bg-white"
                    >
                      <option value="en">English</option>
                      <option value="hi">Hindi (हिन्दी)</option>
                      <option value="ta">Tamil (தமிழ்)</option>
                      <option value="te">Telugu (తెలుగు)</option>
                      <option value="kn">Kannada (ಕನ್ನಡ)</option>
                      <option value="mr">Marathi (मराठी)</option>
                      <option value="bn">Bengali (বাংলা)</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl bg-[#F7F8FA] border border-neutral-200 p-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-[10px] text-[#737373]">Status</p>
                  <p className="font-semibold text-[#16A34A] flex items-center gap-1 mt-0.5 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Verified</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[#737373]">Rating</p>
                  <p className="font-mono-num font-bold text-[#111111] mt-0.5 text-[11px]">
                    {Number(customerProfile?.rating_avg || 5).toFixed(2)} / 5
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[#737373]">Member Since</p>
                  <p className="font-mono-num font-semibold text-[#111111] mt-0.5 text-[11px] truncate">
                    {userProfile?.created_at
                      ? new Date(userProfile.created_at).toLocaleDateString()
                      : 'Active'}
                  </p>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[48px] rounded-2xl bg-[#FFC928] text-[#111111] text-xs font-bold hover:brightness-95 transition cursor-pointer disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save Personal Details'}
              </button>
            </form>
          )}

          {/* 2. PAYMENTS, METHODS & RECEIPTS */}
          {section === 'payments' && (
            <div className="space-y-4">
              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-sm font-bold text-[#111111]">
                      Preferred Payment Mode
                    </h2>
                    <p className="text-[11px] text-[#737373]">
                      Pre-selected automatically when booking a ride.
                    </p>
                  </div>
                  <span className="font-mono-num text-xs font-bold text-[#111111] shrink-0">
                    ₹{totalSpent.toFixed(0)} paid
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'upi', label: 'UPI' },
                      { id: 'online', label: 'Card / Online' },
                      { id: 'cash', label: 'Cash' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleUpdatePreferredPayment(m.id)}
                      className={`min-h-[44px] rounded-xl border text-xs font-bold transition cursor-pointer ${
                        preferredMethod === m.id
                          ? 'bg-[#111111] text-[#FFC928] border-[#111111]'
                          : 'bg-white text-[#111111] border-neutral-200 hover:bg-neutral-50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-[#111111]" />
                  <h2 className="font-display text-sm font-bold text-[#111111]">
                    Transaction & Receipt Ledger
                  </h2>
                </div>

                {payments.length === 0 ? (
                  <div className="py-6 text-center space-y-2">
                    <Receipt className="w-6 h-6 text-neutral-400 mx-auto" />
                    <p className="text-xs text-[#737373]">No transactions available yet.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {payments.map((p) => (
                      <div key={p.id} className="py-3 space-y-2 text-xs">
                        <div className="space-y-0.5">
                          <p className="font-mono-num font-bold text-[#111111]">
                            {p.receipt_number || p.id.slice(0, 8)} · ₹{Number(p.amount).toFixed(2)}
                          </p>
                          <p className="text-[11px] text-[#737373]">
                            {p.payment_method.toUpperCase()} ({p.provider.toUpperCase()}) ·{' '}
                            <span className="capitalize">{p.status.replace(/_/g, ' ')}</span> ·{' '}
                            {new Date(p.paid_at || p.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDownloadReceipt(p)}
                            className="min-h-[40px] px-3 rounded-xl border border-neutral-200 text-[11px] font-semibold text-[#111111] inline-flex items-center gap-1 hover:bg-neutral-50 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Receipt</span>
                          </button>
                          {p.status === 'captured' && (
                            <button
                              type="button"
                              onClick={() => handleRequestRefund(p.id)}
                              className="min-h-[40px] px-3 rounded-xl border border-red-200 text-[11px] font-semibold text-[#DC2626] hover:bg-red-50 cursor-pointer"
                            >
                              Request Refund
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. SAVED PLACES */}
          {section === 'addresses' && (
            <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-4">
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-[#111111] mt-0.5 shrink-0" />
                <div>
                  <h2 className="font-display text-sm font-bold text-[#111111]">
                    Saved Places (Home, Office & Stops)
                  </h2>
                  <p className="text-[11px] text-[#737373]">
                    Verified via Google Maps Geocoding for instant 1-tap drop selection.
                  </p>
                </div>
              </div>

              {savedAddresses.length === 0 ? (
                <p className="text-xs text-[#737373] py-1">
                  No saved addresses yet. Add Home, Office, or any frequent stop below.
                </p>
              ) : (
                <div className="divide-y divide-neutral-100">
                  {savedAddresses.map((addr) => (
                    <div key={addr.id} className="py-3 flex items-center justify-between gap-2.5 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-[#111111]">
                          {addr.label}{' '}
                          <span className="text-[10px] font-mono-num uppercase text-[#737373]">
                            ({addr.address_type})
                          </span>
                        </p>
                        <p className="text-[11px] text-[#737373] truncate">{addr.address_line}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onNavigateTab('home')}
                          className="min-h-[40px] px-3 rounded-xl bg-[#FFC928] text-[#111111] text-[11px] font-bold cursor-pointer"
                        >
                          Book
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAddress(addr.id)}
                          aria-label="Delete saved address"
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#DC2626] hover:bg-red-50 rounded-xl cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleAddAddress} className="space-y-2.5 pt-3 border-t border-neutral-100">
                <p className="text-xs font-bold text-[#111111]">Add New Address</p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={addrType}
                    onChange={(e) => setAddrType(e.target.value as 'home' | 'office' | 'other')}
                    className="h-11 rounded-xl border border-neutral-300 px-3 text-xs bg-white"
                  >
                    <option value="home">Home</option>
                    <option value="office">Office</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Label (e.g. Home)"
                    value={addrLabel}
                    onChange={(e) => setAddrLabel(e.target.value)}
                    className="h-11 rounded-xl border border-neutral-300 px-3 text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Street address or landmark"
                    value={addrLine}
                    onChange={(e) => setAddrLine(e.target.value)}
                    className="flex-1 min-w-0 h-11 rounded-xl border border-neutral-300 px-3 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={savingAddr}
                    className="min-h-[44px] px-4 rounded-xl bg-[#111111] text-[#FFC928] text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{savingAddr ? 'Saving...' : 'Save'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 4. SAFETY CENTER, EMERGENCY CONTACTS & SOS LOGS */}
          {section === 'safety' && (
            <div className="space-y-4">
              {/* Quick SOS & Helplines */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3.5">
                <div className="space-y-1">
                  <h2 className="font-display text-sm font-bold text-[#111111]">
                    24x7 Safety Shield & Helplines
                  </h2>
                  <p className="text-[11px] text-[#737373]">
                    Trigger instant SOS alerts with your live GPS location to SHINE CAB Safety Ops
                    and your trusted contacts.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onTriggerSos}
                  className="w-full min-h-[46px] px-4 rounded-2xl bg-[#DC2626] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-red-700 cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>Trigger Live SOS Alert</span>
                </button>

                <div className="grid grid-cols-1 gap-2">
                  {[
                    { label: 'National Emergency / Police', phone: '112' },
                    { label: 'Ambulance Services', phone: '108' },
                    { label: 'Women Helpline', phone: '1091' },
                  ].map((h) => (
                    <a
                      key={h.phone}
                      href={`tel:${h.phone}`}
                      className="min-h-[44px] rounded-xl border border-neutral-200 px-3.5 py-2 flex items-center justify-between text-xs hover:bg-neutral-50"
                    >
                      <span className="font-semibold text-[#111111]">{h.label}</span>
                      <span className="font-mono-num font-bold text-[#DC2626] inline-flex items-center gap-1">
                        <PhoneCall className="w-3.5 h-3.5" />
                        {h.phone}
                      </span>
                    </a>
                  ))}
                </div>
              </div>

              {/* Emergency Contacts Manager */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3.5">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#DC2626]" />
                  <h2 className="font-display text-sm font-bold text-[#111111]">
                    Trusted Emergency Contacts
                  </h2>
                </div>

                {emergencyContacts.length === 0 ? (
                  <p className="text-xs text-[#737373]">No emergency contacts configured yet.</p>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {emergencyContacts.map((c) => (
                      <div key={c.id} className="py-3 space-y-2 text-xs">
                        <div>
                          <p className="font-bold text-[#111111]">
                            {c.name}{' '}
                            {c.relationship ? (
                              <span className="font-normal text-[#737373]">({c.relationship})</span>
                            ) : null}
                            {c.is_primary && (
                              <span className="ml-2 text-[10px] font-bold uppercase text-[#16A34A]">
                                Primary
                              </span>
                            )}
                          </p>
                          <p className="text-[#737373] font-mono-num">{c.phone}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`tel:${c.phone}`}
                            className="min-h-[40px] px-3 rounded-xl border border-neutral-200 inline-flex items-center gap-1 text-[11px] font-semibold text-[#111111] hover:bg-neutral-50"
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                            <span>Call</span>
                          </a>
                          {!c.is_primary && (
                            <button
                              type="button"
                              onClick={() => handleSetPrimaryContact(c.id)}
                              className="min-h-[40px] px-3 rounded-xl border border-neutral-200 text-[11px] font-semibold text-[#111111] hover:bg-neutral-50 cursor-pointer"
                            >
                              Set Primary
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteContact(c.id)}
                            aria-label="Remove emergency contact"
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#DC2626] hover:bg-red-50 rounded-xl cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={handleAddContact}
                  className="space-y-2.5 pt-3 border-t border-neutral-100"
                >
                  <p className="text-xs font-bold text-[#111111]">Add Trusted Contact</p>
                  <input
                    type="text"
                    required
                    placeholder="Contact name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full h-11 rounded-xl border border-neutral-300 px-3 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="tel"
                      required
                      placeholder="Phone number"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      className="h-11 rounded-xl border border-neutral-300 px-3 text-xs font-mono-num"
                    />
                    <input
                      type="text"
                      placeholder="Relation"
                      value={contactRel}
                      onChange={(e) => setContactRel(e.target.value)}
                      className="h-11 rounded-xl border border-neutral-300 px-3 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingContact}
                    className="w-full min-h-[44px] rounded-xl bg-[#111111] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    {savingContact ? 'Adding...' : 'Add Contact'}
                  </button>
                </form>
              </div>

              {/* SOS Alert History */}
              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-2.5">
                <h2 className="font-display text-sm font-bold text-[#111111]">SOS Alert History</h2>
                {sosAlerts.length === 0 ? (
                  <p className="text-xs text-[#737373]">No SOS alerts have been triggered.</p>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {sosAlerts.map((alert) => (
                      <div key={alert.id} className="py-3 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#111111] uppercase">{alert.status}</span>
                          <span className="text-[11px] text-[#737373] font-mono-num">
                            {new Date(alert.created_at).toLocaleString()}
                          </span>
                        </div>
                        {alert.message && <p className="text-neutral-700">{alert.message}</p>}
                        {alert.dispatched_to?.length > 0 && (
                          <p className="text-[11px] text-[#737373]">
                            Dispatched to: {alert.dispatched_to.join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 5. REWARDS, OFFERS & SAVINGS */}
          {section === 'rewards' && (
            <div className="space-y-4">
              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#FFC928] text-[#111111] flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-sm font-bold text-[#111111]">
                      Total Promo Savings: ₹{totalSavings.toFixed(2)}
                    </h2>
                    <p className="text-[11px] text-[#737373]">
                      {couponUsage.length} redeemed · {coupons.length} active offers available
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('offers')}
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#111111] text-[#FFC928] text-xs font-bold cursor-pointer"
                >
                  Open All Offers
                </button>
              </div>

              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3">
                <h3 className="font-display text-sm font-bold text-[#111111]">Active Promo Codes</h3>
                {coupons.length === 0 ? (
                  <p className="text-xs text-[#737373]">No active promo codes available right now.</p>
                ) : (
                  <div className="space-y-3">
                    {coupons.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-2xl border border-neutral-200 p-3.5 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-num text-xs font-bold text-[#111111] bg-[#FFC928] px-2.5 py-0.5 rounded-lg">
                            {c.code}
                          </span>
                          <span className="text-[11px] text-[#737373] font-mono-num">
                            Exp {new Date(c.expires_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-[#111111]">{c.title}</p>
                          <p className="text-[11px] text-[#737373] mt-0.5">{c.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onApplyCoupon(c.code)}
                          className="min-h-[42px] w-full rounded-xl bg-[#111111] text-white text-xs font-semibold hover:bg-neutral-800 cursor-pointer"
                        >
                          Apply & Book
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {couponUsage.length > 0 && (
                <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-2.5">
                  <h3 className="font-display text-sm font-bold text-[#111111]">Redeemed History</h3>
                  <div className="divide-y divide-neutral-100">
                    {couponUsage.map((u) => (
                      <div key={u.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#111111] truncate">
                            {u.coupons?.code || 'PROMO'} · {u.coupons?.title || 'Ride Discount'}
                          </p>
                          <p className="text-[11px] text-[#737373]">
                            {new Date(u.used_at).toLocaleString()}
                          </p>
                        </div>
                        <span className="font-mono-num font-bold text-[#16A34A] shrink-0">
                          -₹{Number(u.discount_applied || 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. NOTIFICATIONS & PUSH SETTINGS */}
          {section === 'notifications' && (
            <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-4">
              <div className="space-y-2">
                <h2 className="font-display text-sm font-bold text-[#111111]">
                  Notification & Push Controls
                </h2>
                <p className="text-[11px] text-[#737373]">
                  Control real-time trip updates, SMS alerts, and promo notifications.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigateTab('notifications')}
                  className="w-full min-h-[44px] px-4 rounded-xl bg-[#FFC928] text-[#111111] text-xs font-bold cursor-pointer"
                >
                  Open Live Alerts ({unreadNotifications} unread)
                </button>
              </div>

              <div className="divide-y divide-neutral-100 text-xs">
                <label className="py-3 flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="font-bold text-[#111111]">Push Notifications</p>
                    <p className="text-[11px] text-[#737373]">
                      Driver assignment, arrival alerts & live trip OTPs.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={pushEnabled}
                    onChange={(e) => setPushEnabled(e.target.checked)}
                    className="w-5 h-5 accent-[#111111] shrink-0"
                  />
                </label>

                <label className="py-3 flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="font-bold text-[#111111]">SMS Ride Updates</p>
                    <p className="text-[11px] text-[#737373]">
                      Booking confirmations and critical pickup SMS notices.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={smsEnabled}
                    onChange={(e) => setSmsEnabled(e.target.checked)}
                    className="w-5 h-5 accent-[#111111] shrink-0"
                  />
                </label>

                <label className="py-3 flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="font-bold text-[#111111]">Promotional Offers</p>
                    <p className="text-[11px] text-[#737373]">
                      Discount codes and city fare drop announcements.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={promoEnabled}
                    onChange={(e) => setPromoEnabled(e.target.checked)}
                    className="w-5 h-5 accent-[#111111] shrink-0"
                  />
                </label>
              </div>

              <div className="space-y-2 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={handleEnableFcm}
                  className="w-full min-h-[44px] px-4 rounded-xl border border-neutral-300 text-xs font-semibold text-[#111111] hover:bg-neutral-50 cursor-pointer"
                >
                  {customerProfile?.fcm_token
                    ? 'Refresh Device Push Token'
                    : 'Register Device for Firebase Push'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleUpdateNotificationPrefs}
                  className="w-full min-h-[46px] px-5 rounded-xl bg-[#111111] text-[#FFC928] text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </div>
          )}

          {/* 7. APP PREFERENCES, SUPPORT & SYSTEM */}
          {section === 'preferences' && (
            <div className="space-y-4">
              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3">
                <h2 className="font-display text-sm font-bold text-[#111111]">
                  Help, Scheduled Rides & App Tools
                </h2>

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => onNavigateTab('support')}
                    className="w-full min-h-[56px] p-3.5 rounded-2xl border border-neutral-200 hover:border-[#111111] flex items-center justify-between text-left cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-bold text-[#111111]">24x7 Customer Support</p>
                      <p className="text-[11px] text-[#737373] font-mono-num">
                        {openTicketsCount} open · {tickets.length} total tickets
                      </p>
                    </div>
                    <LifeBuoy className="w-5 h-5 text-[#111111] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigateTab('rides')}
                    className="w-full min-h-[56px] p-3.5 rounded-2xl border border-neutral-200 hover:border-[#111111] flex items-center justify-between text-left cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-bold text-[#111111]">Scheduled Rides</p>
                      <p className="text-[11px] text-[#737373] font-mono-num">
                        {upcomingScheduledCount} upcoming bookings
                      </p>
                    </div>
                    <CalendarClock className="w-5 h-5 text-[#111111] shrink-0" />
                  </button>
                </div>

                <div className="pt-3 border-t border-neutral-100 space-y-2.5">
                  <div>
                    <p className="text-xs font-bold text-[#111111]">Install Mobile Web App (PWA)</p>
                    <p className="text-[11px] text-[#737373]">
                      Add SHINE CAB to your home screen for fast 1-tap ride booking.
                    </p>
                  </div>
                  <PWAInstallButton />
                </div>

                <div className="pt-3 border-t border-neutral-100 space-y-2.5">
                  <div>
                    <p className="text-xs font-bold text-[#111111]">App Walkthrough Tour</p>
                    <p className="text-[11px] text-[#737373]">
                      Replay the 3-step SHINE CAB onboarding screens anytime.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onReplayOnboarding}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-neutral-300 text-xs font-semibold text-[#111111] inline-flex items-center justify-center gap-1.5 hover:bg-neutral-50 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Replay Onboarding</span>
                  </button>
                </div>

                <div className="pt-3 border-t border-neutral-100 space-y-2.5">
                  <div>
                    <p className="text-xs font-bold text-[#111111]">Project Source Code (.zip)</p>
                    <p className="text-[11px] text-[#737373]">
                      Download the complete SHINE CAB codebase archive (`shine-cab-source.zip`).
                    </p>
                  </div>
                  <a
                    href="/api/source-zip"
                    download="shine-cab-source.zip"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#111111] text-[#FFC928] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-neutral-800 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Source Code (.zip)</span>
                  </a>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3">
                <h3 className="font-display text-sm font-bold text-[#111111]">
                  Connected Platform Services
                </h3>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  {[
                    { label: 'Google Maps', ok: config.services.maps },
                    { label: 'Supabase DB', ok: config.services.supabase },
                    { label: 'Razorpay', ok: config.services.razorpay },
                    { label: 'Firebase Push', ok: config.services.fcm },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl border border-neutral-200 p-3 space-y-1"
                    >
                      <p className="font-semibold text-[#111111]">{s.label}</p>
                      <p
                        className={`text-[11px] font-semibold ${
                          s.ok ? 'text-[#16A34A]' : 'text-[#737373]'
                        }`}
                      >
                        {s.ok ? 'Configured' : 'Not configured'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 8. LEGAL, PRIVACY, DATA EXPORT & ACCOUNT DELETION */}
          {section === 'legal' && (
            <ProfileLegalSection
              onExportData={handleExportData}
              onDeleteAccount={handleDeleteAccount}
            />
          )}
        </section>
      )}
    </div>
  );
};
