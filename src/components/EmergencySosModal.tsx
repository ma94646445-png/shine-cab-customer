import React, { useState } from 'react';
import { ShieldAlert, PhoneCall, X, CheckCircle2 } from 'lucide-react';
import { addDoc, collection } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { EmergencyContact } from '../types/shinecab';

interface EmergencySosModalProps {
  rideId?: string | null;
  customerUid: string;
  contacts: EmergencyContact[];
  onClose: () => void;
}

export const EmergencySosModal: React.FC<EmergencySosModalProps> = ({
  rideId,
  customerUid,
  contacts,
  onClose,
}) => {
  const [message, setMessage] = useState('Emergency SOS alert triggered from SHINE CAB');
  const [sending, setSending] = useState(false);
  const [dispatchedTo, setDispatchedTo] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDispatch = () => {
    setSending(true);
    setError(null);

    const submitWithCoords = async (lat?: number, lng?: number) => {
      const recipients = [
        'SHINE CAB Safety Ops',
        ...contacts.map((c) => `${c.name} (${c.phone})`),
      ];
      try {
        await addDoc(collection(db, 'sos_alerts'), {
          customer_uid: customerUid,
          ride_id: rideId || null,
          lat: lat ?? null,
          lng: lng ?? null,
          message: message.trim() || 'Emergency SOS triggered',
          status: 'dispatched',
          dispatched_to: recipients,
          resolved_at: null,
          created_at: new Date().toISOString(),
        });
        setDispatchedTo(recipients);
      } catch (err) {
        setError('Unable to save SOS alert. Dial emergency helpline 112 immediately.');
        try {
          handleFirestoreError(err, OperationType.CREATE, 'sos_alerts');
        } catch {
          // logged
        }
      } finally {
        setSending(false);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => submitWithCoords(pos.coords.latitude, pos.coords.longitude),
        () => submitWithCoords(undefined, undefined),
        { timeout: 4000 }
      );
    } else {
      submitWithCoords(undefined, undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm flex items-end justify-center">
      <div className="bg-white rounded-t-3xl w-full p-5 pb-[max(env(safe-area-inset-bottom),16px)] shadow-2xl border-t border-neutral-200 space-y-4 max-h-[88%] overflow-y-auto">
        <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#DC2626]">
            <ShieldAlert className="w-6 h-6" />
            <h3 className="font-display text-lg font-bold text-[#111111]">Emergency SOS</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close SOS modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {dispatchedTo ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-[#16A34A] space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>SOS Alert Recorded & Dispatched</span>
              </div>
              <p>Notified: {dispatchedTo.join(', ')}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] rounded-xl bg-[#111111] text-white text-sm font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-[#737373] leading-relaxed">
              Triggering SOS records an emergency alert with your live GPS coordinates and notifies SHINE CAB Safety Operations and your trusted contacts.
            </p>

            {contacts.length > 0 && (
              <div className="rounded-xl bg-[#F7F8FA] p-3 text-xs space-y-1">
                <p className="font-semibold text-[#111111]">Configured Emergency Contacts</p>
                {contacts.map((c) => (
                  <p key={c.id} className="text-[#737373]">
                    {c.name} · <span className="font-mono-num">{c.phone}</span>
                  </p>
                ))}
              </div>
            )}

            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#DC2626]"
            />

            {error && (
              <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-[#DC2626] font-medium">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                disabled={sending}
                onClick={handleDispatch}
                className="w-full min-h-[48px] rounded-2xl bg-[#DC2626] text-white font-bold text-sm hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {sending ? 'Dispatching SOS Alert...' : 'Trigger Emergency SOS Alert'}
              </button>
              <a
                href="tel:112"
                className="w-full min-h-[44px] rounded-xl border border-neutral-300 text-[#111111] font-semibold text-xs flex items-center justify-center gap-2 hover:bg-neutral-50"
              >
                <PhoneCall className="w-4 h-4" />
                <span>Call Emergency Helpline (112)</span>
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
