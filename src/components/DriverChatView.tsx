import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Phone,
  Copy,
  Check,
  Send,
  Star,
  Car,
  KeyRound,
  MessageSquare,
  History,
  MapPin,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { SupabaseClient } from '@supabase/supabase-js';
import { RideMessage, RideRecord } from '../types/shinecab';

interface DriverChatViewProps {
  rides: RideRecord[];
  activeRide: RideRecord | null;
  selectedRideId: string | null;
  accessToken: string | null;
  supabase: SupabaseClient | null;
  onSelectRide: (rideId: string) => void;
  onBack: () => void;
  onRequireAuth?: () => void;
}

const QUICK_REPLIES = [
  'Main pickup point par hoon.',
  'Aane par call karein.',
  '2 minute mein pahunch raha hoon.',
  'Please follow the map pin.',
];

export const DriverChatView: React.FC<DriverChatViewProps> = ({
  rides,
  activeRide,
  selectedRideId,
  accessToken,
  supabase,
  onSelectRide,
  onBack,
  onRequireAuth,
}) => {
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'history'>('chat');
  const [historyQuery, setHistoryQuery] = useState('');
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [wsLive, setWsLive] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // All rides that have a captain assigned (active first, then newest)
  const driverRides = useMemo(() => {
    const map = new Map<string, RideRecord>();
    if (activeRide) {
      map.set(activeRide.id, activeRide);
    }
    for (const r of rides) {
      if (r.drivers || r.driver_id) {
        if (!map.has(r.id)) map.set(r.id, r);
      }
    }
    return Array.from(map.values());
  }, [rides, activeRide]);

  const filteredDriverRides = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return driverRides;
    return driverRides.filter((r) => {
      const drvName = (r.drivers?.users?.full_name || '').toLowerCase();
      const plate = (r.vehicles?.registration_number || '').toLowerCase();
      const model = `${r.vehicles?.make || ''} ${r.vehicles?.model || ''}`.toLowerCase();
      const code = (r.ride_code || '').toLowerCase();
      return drvName.includes(q) || plate.includes(q) || model.includes(q) || code.includes(q);
    });
  }, [driverRides, historyQuery]);

  const currentRide = useMemo(() => {
    if (selectedRideId) {
      const exact = driverRides.find((r) => r.id === selectedRideId);
      if (exact) return exact;
    }
    if (activeRide) return activeRide;
    return driverRides[0] || null;
  }, [driverRides, selectedRideId, activeRide]);

  const driver = currentRide?.drivers || null;
  const vehicle = currentRide?.vehicles || null;
  const driverName = driver?.users?.full_name || 'Assigned Captain';
  const driverPhone = driver?.users?.phone || '';
  const driverAvatar = driver?.users?.avatar_url || null;
  const vehicleCategoryName = currentRide?.vehicle_categories?.name || 'Cab';

  // Load messages when currentRide or accessToken changes
  useEffect(() => {
    if (!currentRide || !accessToken) {
      setMessages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/rides/${currentRide.id}/messages`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok) {
          setError(d.error || 'Unable to load chat history.');
        } else {
          setMessages(d.messages || []);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error while loading messages.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentRide?.id, accessToken]);

  // Real-time chat updates via WebSocket + Supabase Realtime
  useEffect(() => {
    if (!currentRide) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onopen = () => {
      setWsLive(true);
      ws.send(JSON.stringify({ type: 'subscribe', channel: `ride:${currentRide.id}` }));
    };
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data);
        if (frame.event === 'chat:message' && frame.payload?.id) {
          setMessages((prev) =>
            prev.some((m) => m.id === frame.payload.id) ? prev : [...prev, frame.payload]
          );
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => setWsLive(false);

    let channel: ReturnType<SupabaseClient['channel']> | null = null;
    if (supabase) {
      channel = supabase
        .channel(`ride-chat-${currentRide.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'ride_messages',
            filter: `ride_id=eq.${currentRide.id}`,
          },
          (payload) => {
            const incoming = payload.new as RideMessage;
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
            );
          }
        )
        .subscribe();
    }

    return () => {
      ws.close();
      if (supabase && channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [currentRide?.id, supabase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMessage = async (msgText: string) => {
    if (!currentRide || !accessToken) {
      onRequireAuth?.();
      return;
    }
    const trimmed = msgText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/rides/${currentRide.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to send message.');
        return;
      }
      if (data.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]
        );
      }
      setText('');
    } catch {
      setError('Network error while sending message.');
    } finally {
      setSending(false);
    }
  };

  const handleCopyPhone = async (phoneValue: string) => {
    if (!phoneValue || !navigator.clipboard) return;
    await navigator.clipboard.writeText(phoneValue);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full bg-white overflow-hidden">
      {/* Top Bar + Phone Segmented Switch */}
      <div className="bg-white border-b border-neutral-200 px-3.5 py-2.5 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Home"
            className="min-h-[44px] min-w-[44px] rounded-xl border border-neutral-200 flex items-center justify-center text-[#111111] hover:bg-neutral-50 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-base font-bold text-[#111111] truncate">
              Driver Chat & History
            </h1>
            <p className="text-[11px] text-[#737373] font-mono-num truncate">
              {currentRide
                ? `${currentRide.ride_code} · ${wsLive ? 'Live chat connected' : 'Syncing chat'}`
                : `${driverRides.length} driver trip${driverRides.length === 1 ? '' : 's'} on record`}
            </p>
          </div>
        </div>

        {/* Full-Width Switcher between Live Chat & Driver History */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-[#F7F8FA] border border-neutral-200 rounded-xl">
          <button
            type="button"
            onClick={() => setMobilePanel('chat')}
            className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold cursor-pointer transition ${
              mobilePanel === 'chat'
                ? 'bg-[#111111] text-[#FFC928]'
                : 'text-[#737373]'
            }`}
          >
            Live Chat
          </button>
          <button
            type="button"
            onClick={() => setMobilePanel('history')}
            className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold cursor-pointer transition ${
              mobilePanel === 'history'
                ? 'bg-[#111111] text-[#FFC928]'
                : 'text-[#737373]'
            }`}
          >
            Driver History ({driverRides.length})
          </button>
        </div>
      </div>

      {/* Main Phone Panel Switch */}
      {mobilePanel === 'history' ? (
        <aside className="flex-1 min-h-0 flex flex-col bg-[#F7F8FA] overflow-hidden">
          <div className="p-3.5 border-b border-neutral-200 bg-white space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#111111]" />
                <h2 className="font-display text-sm font-bold text-[#111111]">
                  Driver History
                </h2>
              </div>
              <span className="text-[11px] font-mono-num font-semibold text-[#737373]">
                {driverRides.length} total
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Search driver name, gadi no..."
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-200 bg-[#F7F8FA] text-xs text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 space-y-2.5">
            {filteredDriverRides.length === 0 ? (
              <div className="bg-white rounded-2xl border border-neutral-200 p-5 text-center space-y-2">
                <Car className="w-7 h-7 text-neutral-300 mx-auto" />
                <p className="text-xs font-bold text-[#111111]">
                  {driverRides.length === 0 ? 'No Driver History Yet' : 'No Matching Drivers'}
                </p>
                <p className="text-[11px] text-[#737373]">
                  {driverRides.length === 0
                    ? 'When you book a Bike, Auto, or Cab ride, your captain photo, vehicle number, call option, and chat history stay saved here.'
                    : 'Try searching by another driver name or vehicle plate number.'}
                </p>
              </div>
            ) : (
              filteredDriverRides.map((ride) => {
                const isSelected = currentRide?.id === ride.id;
                const dName = ride.drivers?.users?.full_name || 'Verified Captain';
                const dPhoto = ride.drivers?.users?.avatar_url || null;
                const dPhone = ride.drivers?.users?.phone || '';
                const dRating = Number(ride.drivers?.rating_avg || 5).toFixed(1);
                const plate = ride.vehicles?.registration_number || 'Assigning plate';
                const vModel = ride.vehicles
                  ? `${ride.vehicles.color} ${ride.vehicles.make} ${ride.vehicles.model}`
                  : ride.vehicle_categories?.name || 'Cab';

                return (
                  <div
                    key={ride.id}
                    className={`rounded-2xl border p-3 bg-white transition space-y-2.5 ${
                      isSelected
                        ? 'border-[#111111] ring-2 ring-[#FFC928]/60 shadow-xs'
                        : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectRide(ride.id);
                        setMobilePanel('chat');
                      }}
                      className="w-full text-left flex items-start gap-2.5 cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-full bg-[#111111] text-[#FFC928] font-display text-sm font-bold flex items-center justify-center shrink-0 overflow-hidden border border-neutral-200">
                        {dPhoto ? (
                          <img
                            src={dPhoto}
                            alt={dName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          dName.charAt(0).toUpperCase()
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-display font-bold text-xs text-[#111111] truncate">
                            {dName}
                          </p>
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-mono-num font-semibold text-[#111111] shrink-0">
                            <Star className="w-3 h-3 text-[#FFC928] fill-[#FFC928]" />
                            {dRating}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-num text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#F7F8FA] border border-neutral-300 text-[#111111]">
                            {plate}
                          </span>
                          <span className="font-mono-num text-xs font-bold text-[#111111]">
                            ₹{Number(ride.total_fare).toFixed(0)}
                          </span>
                        </div>

                        <p className="text-[11px] text-[#737373] truncate">{vModel}</p>
                        <p className="text-[10px] font-mono-num text-[#737373]">
                          {ride.ride_code} · {new Date(ride.created_at).toLocaleDateString()} ·{' '}
                          <span className="capitalize">{ride.status.replace(/_/g, ' ')}</span>
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 pt-2 border-t border-neutral-100">
                      {dPhone && (
                        <a
                          href={`tel:${dPhone}`}
                          className="flex-1 min-h-[40px] px-2.5 rounded-xl border border-neutral-200 bg-white text-[#111111] text-[11px] font-semibold inline-flex items-center justify-center gap-1 hover:bg-neutral-50"
                        >
                          <Phone className="w-3.5 h-3.5 text-[#16A34A]" />
                          <span>Call</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          onSelectRide(ride.id);
                          setMobilePanel('chat');
                        }}
                        className="flex-1 min-h-[40px] px-2.5 rounded-xl bg-[#FFC928] text-[#111111] text-[11px] font-bold inline-flex items-center justify-center gap-1 hover:brightness-95 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Live Chat</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      ) : (
        <section className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
          {!currentRide ? (
            <div className="flex-1 flex items-center justify-center p-5 overflow-y-auto">
              <div className="w-full bg-[#F7F8FA] border border-neutral-200 rounded-3xl p-5 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-[#FFC928] text-[#111111] flex items-center justify-center mx-auto">
                  <Car className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-display text-base font-bold text-[#111111]">
                    Ready for Driver Chat & History
                  </h2>
                  <p className="text-xs text-[#737373] leading-relaxed">
                    Book a ride or scan Nearby Drivers on Home Map to see your captain’s photo, full name, vehicle number plate, vehicle details, phone call button, and live chat here.
                  </p>
                </div>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={onBack}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-[#111111] text-white font-semibold text-xs hover:bg-neutral-800 cursor-pointer"
                  >
                    Find Nearby Drivers on Map
                  </button>
                  {!accessToken && onRequireAuth && (
                    <button
                      type="button"
                      onClick={onRequireAuth}
                      className="w-full min-h-[44px] px-4 rounded-xl bg-[#FFC928] text-[#111111] font-bold text-xs hover:brightness-95 cursor-pointer"
                    >
                      Login to Sync History
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Pinned Compact Driver Identity, Image, Vehicle Plate & Call Row */}
              <div className="p-3 bg-[#F7F8FA] border-b border-neutral-200 space-y-2.5 shrink-0">
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-12 h-12 rounded-full bg-[#111111] text-[#FFC928] font-display text-base font-bold flex items-center justify-center shrink-0 overflow-hidden border-2 border-white shadow-sm">
                      {driverAvatar ? (
                        <img
                          src={driverAvatar}
                          alt={driverName}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        driverName.charAt(0).toUpperCase()
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h2 className="font-display font-bold text-sm text-[#111111] truncate">
                          {driverName}
                        </h2>
                        <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-[#737373]">
                        <span className="inline-flex items-center gap-0.5 font-mono-num font-bold text-[#111111]">
                          <Star className="w-3 h-3 text-[#FFC928] fill-[#FFC928]" />
                          {Number(driver?.rating_avg || 5).toFixed(1)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">
                          {vehicle
                            ? `${vehicle.color} ${vehicle.make} ${vehicle.model}`
                            : vehicleCategoryName}
                        </span>
                      </div>
                    </div>
                  </div>

                  {currentRide.ride_otp && (
                    <div className="flex items-center gap-1 bg-[#111111] text-white px-2.5 py-1.5 rounded-xl shrink-0">
                      <KeyRound className="w-3 h-3 text-[#FFC928]" />
                      <span className="font-mono-num text-xs font-bold text-[#FFC928]">
                        {currentRide.ride_otp}
                      </span>
                    </div>
                  )}
                </div>

                {/* Gadi Number Plate + Call/Copy */}
                <div className="flex items-center justify-between gap-2 bg-white rounded-xl border border-neutral-200 px-3 py-2">
                  <div className="min-w-0">
                    {vehicle ? (
                      <div className="flex items-center gap-1.5">
                        <Car className="w-3.5 h-3.5 text-[#111111] shrink-0" />
                        <span className="font-mono-num text-xs font-bold text-[#111111]">
                          {vehicle.registration_number}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-[#737373]">Assigning vehicle</span>
                    )}
                    <p className="font-mono-num text-[11px] text-[#737373] truncate">
                      {driverPhone || 'Phone once assigned'}
                    </p>
                  </div>

                  {driverPhone && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyPhone(driverPhone)}
                        aria-label="Copy driver phone number"
                        className="min-h-[38px] px-2.5 rounded-xl border border-neutral-200 text-xs font-semibold text-[#111111] inline-flex items-center gap-1 hover:bg-neutral-50 cursor-pointer"
                      >
                        {copiedPhone ? (
                          <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <a
                        href={`tel:${driverPhone}`}
                        className="min-h-[38px] px-3 rounded-xl bg-[#16A34A] text-white text-xs font-bold inline-flex items-center gap-1 hover:bg-green-700"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Call</span>
                      </a>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] px-1">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <MapPin className="w-3 h-3 text-[#16A34A] shrink-0" />
                    <span className="truncate text-[#111111] font-medium">
                      {currentRide.pickup_address} → {currentRide.drop_address}
                    </span>
                  </div>
                  <span className="font-mono-num font-bold text-[#111111] shrink-0">
                    ₹{Number(currentRide.total_fare).toFixed(0)}
                  </span>
                </div>
              </div>

              {/* Live Messages Feed */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 space-y-2.5 bg-white">
                {loading ? (
                  <div className="space-y-2.5">
                    <div className="h-12 w-2/3 bg-neutral-100 rounded-2xl animate-pulse" />
                    <div className="h-12 w-1/2 bg-neutral-100 rounded-2xl animate-pulse ml-auto" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="py-8 text-center space-y-2">
                    <MessageSquare className="w-8 h-8 text-neutral-300 mx-auto" />
                    <p className="text-sm font-semibold text-[#111111]">
                      Live Chat with {driverName}
                    </p>
                    <p className="text-xs text-[#737373] max-w-xs mx-auto">
                      Send a message below or tap a quick reply to coordinate pickup & arrival live.
                    </p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const isCustomer = m.sender_role === 'customer';
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                            isCustomer
                              ? 'bg-[#111111] text-white rounded-br-sm'
                              : 'bg-[#F7F8FA] text-[#111111] border border-neutral-200 rounded-bl-sm'
                          }`}
                        >
                          {m.message}
                        </div>
                        <span className="text-[10px] text-[#737373] mt-1 font-mono-num">
                          {isCustomer ? 'You' : driverName} ·{' '}
                          {new Date(m.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              {/* Docked Quick Replies & Input */}
              <div className="shrink-0 border-t border-neutral-200 bg-white p-3 space-y-2">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {QUICK_REPLIES.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={sending}
                      onClick={() => sendMessage(preset)}
                      className="min-h-[34px] px-3 rounded-xl bg-[#F7F8FA] border border-neutral-200 text-[11px] font-medium text-[#111111] hover:bg-neutral-100 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                {error && (
                  <p role="alert" className="text-xs text-[#DC2626] font-medium">
                    {error}
                  </p>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage(text);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={`Message ${driverName}...`}
                    className="flex-1 h-11 rounded-xl border border-neutral-300 bg-[#F7F8FA] px-3.5 text-xs text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
                  />
                  <button
                    type="submit"
                    disabled={sending || !text.trim()}
                    aria-label="Send message"
                    className="min-h-[44px] px-4 rounded-xl bg-[#FFC928] text-[#111111] font-semibold text-xs inline-flex items-center gap-1.5 hover:brightness-95 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
};
