import React from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { NotificationRecord } from '../types/shinecab';

interface NotificationsSheetProps {
  notifications: NotificationRecord[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onNavigateDeepLink: (link: string) => void;
  onClose: () => void;
}

export const NotificationsSheet: React.FC<NotificationsSheetProps> = ({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onNavigateDeepLink,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl border-l border-neutral-200 flex flex-col">
        <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#111111]" />
            <h3 className="font-display text-base font-bold text-[#111111]">Notifications</h3>
          </div>
          <div className="flex items-center gap-1">
            {notifications.some((n) => !n.is_read) && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="min-h-[44px] px-2.5 text-xs font-semibold text-[#111111] hover:bg-neutral-100 rounded-xl inline-flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
          {notifications.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Bell className="w-8 h-8 text-neutral-300 mx-auto" />
              <p className="text-sm font-medium text-[#111111]">No notifications yet.</p>
              <p className="text-xs text-[#737373]">
                Ride updates, OTP alerts, payment receipts, and support replies appear here.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (!n.is_read) onMarkRead(n.id);
                  if (n.deep_link) onNavigateDeepLink(n.deep_link);
                  onClose();
                }}
                className={`w-full p-4 text-left hover:bg-[#F7F8FA] transition cursor-pointer ${
                  n.is_read ? 'bg-white' : 'bg-[#FFC928]/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#111111]">{n.title}</p>
                  {!n.is_read && (
                    <span className="text-[11px] font-semibold text-[#111111]">Unread</span>
                  )}
                </div>
                <p className="text-xs text-[#737373] mt-1 leading-relaxed">{n.body}</p>
                <p className="text-[11px] text-neutral-400 mt-2 font-mono-num">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
