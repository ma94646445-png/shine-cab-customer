import React, { useMemo, useState } from 'react';
import {
  Bell,
  CheckCheck,
  Car,
  CreditCard,
  ShieldAlert,
  Tag,
  LifeBuoy,
  ArrowRight,
  Radio,
} from 'lucide-react';
import { NotificationRecord } from '../types/shinecab';

interface NotificationsViewProps {
  notifications: NotificationRecord[];
  wsConnected: boolean;
  isAuthenticated?: boolean;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onNavigateDeepLink: (link: string) => void;
  onRefresh: () => void;
  onRequireAuth?: () => void;
}

type FilterKey = 'all' | 'unread' | 'rides' | 'payments' | 'offers' | 'safety';

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  wsConnected,
  isAuthenticated = true,
  onMarkRead,
  onMarkAllRead,
  onNavigateDeepLink,
  onRefresh,
  onRequireAuth,
}) => {
  const [filter, setFilter] = useState<FilterKey>('all');

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'unread') return !n.is_read;
      if (filter === 'rides') {
        return [
          'otp',
          'booking_confirmation',
          'driver_assigned',
          'driver_arriving',
          'driver_reached_pickup',
          'ride_started',
          'ride_completed',
          'ride_cancellation',
        ].includes(n.notification_type);
      }
      if (filter === 'payments') {
        return ['payment_confirmation', 'refund_update'].includes(n.notification_type);
      }
      if (filter === 'offers') {
        return n.notification_type === 'promotional_offer';
      }
      if (filter === 'safety') {
        return ['sos_alert', 'support_update'].includes(n.notification_type);
      }
      return true;
    });
  }, [notifications, filter]);

  const getIconForType = (type: string) => {
    if (['payment_confirmation', 'refund_update'].includes(type)) {
      return <CreditCard className="w-4 h-4 text-[#16A34A]" />;
    }
    if (type === 'sos_alert') {
      return <ShieldAlert className="w-4 h-4 text-[#DC2626]" />;
    }
    if (type === 'promotional_offer') {
      return <Tag className="w-4 h-4 text-[#111111]" />;
    }
    if (type === 'support_update') {
      return <LifeBuoy className="w-4 h-4 text-[#111111]" />;
    }
    return <Car className="w-4 h-4 text-[#111111]" />;
  };

  return (
    <div className="w-full p-4 space-y-4">
      {/* Header */}
      <div className="space-y-3">
        <div>
          <h1 className="font-display text-xl font-bold text-[#111111]">
            Live Notifications
          </h1>
          <div className="flex items-center gap-2 text-xs text-[#737373] mt-1">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                wsConnected ? 'bg-[#16A34A] animate-pulse' : 'bg-amber-500'
              }`}
            />
            <Radio
              className={`w-3.5 h-3.5 shrink-0 ${wsConnected ? 'text-[#16A34A]' : 'text-neutral-400'}`}
            />
            <span className="truncate">
              {wsConnected
                ? 'Live stream active — ride, driver, OTP & payment alerts'
                : 'Reconnecting live update stream...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[40px] px-3.5 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-[#111111] hover:bg-neutral-50 cursor-pointer"
          >
            Refresh
          </button>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="min-h-[40px] px-3.5 rounded-xl bg-[#111111] text-[#FFC928] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-900 cursor-pointer"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Mark all read ({unreadCount})</span>
            </button>
          )}
        </div>
      </div>

      {!isAuthenticated && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-bold text-[#111111]">
              Live alerts stream automatically here
            </p>
            <p className="text-xs text-[#737373] leading-relaxed">
              Sign in to receive personal ride OTPs, captain arrival alerts, and Razorpay receipts in real time.
            </p>
          </div>
          {onRequireAuth && (
            <button
              type="button"
              onClick={onRequireAuth}
              className="w-full min-h-[42px] rounded-xl bg-[#FFC928] text-[#111111] text-xs font-bold hover:brightness-95 cursor-pointer"
            >
              Login for Ride Alerts
            </button>
          )}
        </div>
      )}

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {(
          [
            { id: 'all', label: 'All' },
            { id: 'unread', label: `Unread (${unreadCount})` },
            { id: 'rides', label: 'Ride Updates' },
            { id: 'payments', label: 'Payments' },
            { id: 'offers', label: 'Offers' },
            { id: 'safety', label: 'Safety & Support' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition ${
              filter === tab.id
                ? 'bg-[#FFC928] text-[#111111]'
                : 'bg-white border border-neutral-200 text-[#737373] hover:text-[#111111]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
        {filtered.length === 0 ? (
          <div className="p-8 text-center space-y-2.5">
            <Bell className="w-9 h-9 text-neutral-300 mx-auto" />
            <p className="font-display text-sm font-bold text-[#111111]">
              No notifications in this view
            </p>
            <p className="text-xs text-[#737373] mx-auto">
              Real-time booking confirmations, driver assignment alerts, ride OTP updates, payments, and support replies stream here automatically.
            </p>
          </div>
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              className={`p-4 space-y-3 transition ${
                n.is_read ? 'bg-white' : 'bg-[#FFC928]/10'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#F7F8FA] border border-neutral-200 flex items-center justify-center shrink-0 mt-0.5">
                  {getIconForType(n.notification_type)}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display font-bold text-sm text-[#111111]">
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <span className="text-[11px] font-bold text-[#111111] shrink-0">
                        Unread
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-700 leading-relaxed">
                    {n.body}
                  </p>
                  <p className="text-[11px] text-[#737373] font-mono-num">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {(!n.is_read || n.deep_link) && (
                <div className="flex items-center gap-2 pl-12">
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={() => onMarkRead(n.id)}
                      className="min-h-[38px] px-3 rounded-xl border border-neutral-200 bg-white text-xs font-semibold text-[#111111] hover:bg-neutral-50 cursor-pointer"
                    >
                      Mark read
                    </button>
                  )}
                  {n.deep_link && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!n.is_read) onMarkRead(n.id);
                        onNavigateDeepLink(n.deep_link!);
                      }}
                      className="min-h-[38px] px-3.5 rounded-xl bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1 hover:bg-neutral-800 cursor-pointer"
                    >
                      <span>Open</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
