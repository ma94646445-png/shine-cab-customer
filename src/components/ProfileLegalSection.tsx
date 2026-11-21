import React, { useState } from 'react';
import {
  FileText,
  Lock,
  Download,
  Trash2,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

interface ProfileLegalSectionProps {
  onExportData: () => void;
  onDeleteAccount: () => Promise<void>;
}

type LegalDocTab = 'privacy' | 'terms' | 'refund';

export const ProfileLegalSection: React.FC<ProfileLegalSectionProps> = ({
  onExportData,
  onDeleteAccount,
}) => {
  const [docTab, setDocTab] = useState<LegalDocTab>('privacy');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteAccount();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Legal Documents */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3.5">
        <div className="flex items-center gap-2.5">
          <FileText className="w-5 h-5 text-[#111111] shrink-0" />
          <div>
            <h2 className="font-display text-sm font-bold text-[#111111]">
              Policies & Legal Information
            </h2>
            <p className="text-[11px] text-[#737373]">
              SHINE CAB customer terms, location privacy, and fare refund rules.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-neutral-100 pb-3">
          {(
            [
              { id: 'privacy', label: 'Privacy Policy' },
              { id: 'terms', label: 'Terms & Conditions' },
              { id: 'refund', label: 'Cancellation & Refunds' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setDocTab(t.id)}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold transition cursor-pointer ${
                docTab === t.id
                  ? 'bg-[#111111] text-[#FFC928]'
                  : 'bg-neutral-100 text-[#737373] hover:text-[#111111]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {docTab === 'privacy' && (
          <div className="space-y-3 text-xs text-neutral-700 leading-relaxed">
            <h3 className="font-display text-sm font-bold text-[#111111]">
              SHINE CAB Privacy Policy
            </h3>
            <p>
              <strong>1. Location & Trip Data:</strong> Precise GPS pickup/drop coordinates and
              active ride telemetry are collected strictly to match verified drivers, calculate exact
              distance/time fares, and power live safety sharing links.
            </p>
            <p>
              <strong>2. Identity & Contacts:</strong> Your verified mobile number, profile name,
              saved addresses, and emergency contacts are protected with Row-Level Security (RLS) so
              only your authenticated session can access or update them.
            </p>
            <p>
              <strong>3. Driver Privacy Scope:</strong> Assigned captains receive only the trip
              pickup/drop coordinates and ride communication required to complete your booking.
            </p>
            <p>
              <strong>4. Data Control:</strong> You can export a full JSON copy of your account
              records or permanently delete your account below at any time.
            </p>
          </div>
        )}

        {docTab === 'terms' && (
          <div className="space-y-3 text-xs text-neutral-700 leading-relaxed">
            <h3 className="font-display text-sm font-bold text-[#111111]">
              SHINE CAB Terms & Conditions
            </h3>
            <p>
              <strong>1. Booking & Ride OTP:</strong> Every confirmed ride generates a unique
              4-digit start OTP. Share the OTP only after verifying the captain’s photo, name, and
              vehicle registration plate.
            </p>
            <p>
              <strong>2. Fare Authority:</strong> Final trip fares are computed server-side from
              configured vehicle category tariffs, distance, duration, applicable surge/night rules,
              taxes, and verified promo codes.
            </p>
            <p>
              <strong>3. Conduct & Safety:</strong> Both riders and captains must follow traffic
              laws, helmet/seatbelt norms, and respectful behavior. Abuse or unsafe conduct may
              result in account suspension.
            </p>
          </div>
        )}

        {docTab === 'refund' && (
          <div className="space-y-3 text-xs text-neutral-700 leading-relaxed">
            <h3 className="font-display text-sm font-bold text-[#111111]">
              Cancellation & Refund Policy
            </h3>
            <p>
              <strong>1. Pre-Arrival Cancellation:</strong> Cancelling while searching for a driver
              incurs zero charge. Cancelling after driver assignment beyond the grace window may
              apply the category cancellation fee shown before confirmation.
            </p>
            <p>
              <strong>2. Online & UPI Refunds:</strong> Verified Razorpay payments eligible for
              refund can be submitted directly from Profile &gt; Payments &amp; Receipts. Approved
              refunds are settled back to the original payment source.
            </p>
            <p>
              <strong>3. Dispute Resolution:</strong> For double-charge or fare mismatch issues,
              create a Payment support ticket referencing your ride code and receipt number.
            </p>
          </div>
        )}
      </div>

      {/* Data Export & Privacy Control */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-[#16A34A]" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold text-[#111111]">
              Download Your SHINE CAB Data
            </h3>
            <p className="text-[11px] text-[#737373] mt-0.5">
              Export your profile details, rides, saved addresses, emergency contacts, and payment
              records as a JSON file.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExportData}
          className="w-full min-h-[44px] px-4 rounded-xl border border-neutral-300 bg-white text-xs font-semibold text-[#111111] inline-flex items-center justify-center gap-1.5 hover:bg-neutral-50 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export JSON</span>
        </button>
      </div>

      {/* Account Deletion */}
      <div className="bg-white rounded-3xl border border-red-200 p-4 space-y-3.5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-[#DC2626]" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-sm font-bold text-[#111111]">
              Account Security & Permanent Deletion
            </h3>
            <p className="text-xs text-[#737373] mt-0.5">
              Deleting your account permanently removes your profile, saved places, and login access.
              This action cannot be undone.
            </p>
          </div>
        </div>

        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-[44px] px-4 rounded-xl border border-red-300 text-[#DC2626] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-red-50 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete My Account</span>
          </button>
        ) : (
          <div className="rounded-2xl bg-red-50 border border-red-200 p-4 space-y-3">
            <div className="flex items-start gap-2 text-xs text-red-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC2626]" />
              <span>
                Type <strong className="font-mono-num">DELETE</strong> below to permanently delete
                your SHINE CAB account.
              </span>
            </div>
            <input
              type="text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="w-full h-11 rounded-xl border border-red-300 bg-white px-3 text-xs font-mono-num focus:outline-none focus:border-[#DC2626]"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteText('');
                }}
                className="min-h-[40px] px-4 rounded-xl border border-neutral-300 bg-white text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || deleteText.trim().toUpperCase() !== 'DELETE'}
                onClick={handleDelete}
                className="min-h-[40px] px-4 rounded-xl bg-[#DC2626] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete Account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
