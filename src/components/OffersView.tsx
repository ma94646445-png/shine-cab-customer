import React from 'react';
import { Tag, Copy, Check } from 'lucide-react';
import { Coupon } from '../types/shinecab';

interface CouponUsageRow {
  id: string;
  discount_applied: number;
  used_at: string;
  coupons?: { code: string; title: string } | null;
}

interface OffersViewProps {
  coupons: Coupon[];
  usageHistory: CouponUsageRow[];
  loading: boolean;
  onApplyCoupon: (code: string) => void;
}

export const OffersView: React.FC<OffersViewProps> = ({
  coupons,
  usageHistory,
  loading,
  onApplyCoupon,
}) => {
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="w-full p-4 space-y-5">
      <div>
        <h1 className="font-display text-xl font-bold text-[#111111]">Offers & Promo Codes</h1>
        <p className="text-xs text-[#737373]">
          Active discounts validated against backend fare rules and eligibility.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-36 bg-white rounded-2xl border border-neutral-200 animate-pulse" />
          <div className="h-36 bg-white rounded-2xl border border-neutral-200 animate-pulse" />
        </div>
      ) : coupons.length === 0 ? (
        <div className="bg-white rounded-3xl border border-neutral-200 p-8 text-center space-y-2">
          <Tag className="w-8 h-8 text-neutral-300 mx-auto" />
          <p className="text-sm font-semibold text-[#111111]">No promotional offers available right now.</p>
          <p className="text-xs text-[#737373]">
            Admin-published coupons and first-ride offers will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-num text-sm font-bold bg-[#111111] text-[#FFC928] px-3 py-1 rounded-lg">
                    {c.code}
                  </span>
                  <span className="text-xs text-[#737373] font-mono-num">
                    Expires {new Date(c.expires_at).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="font-display text-base font-bold text-[#111111]">{c.title}</h3>
                <p className="text-xs text-[#737373] leading-relaxed">{c.description}</p>
                <p className="text-[11px] text-neutral-600 font-mono-num">
                  Min ride ₹{c.min_ride_amount}
                  {c.max_discount ? ` · Max discount ₹${c.max_discount}` : ''}
                  {c.first_ride_only ? ' · First ride only' : ''}
                  {c.applicable_category_slug ? ` · ${c.applicable_category_slug.toUpperCase()} only` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => handleCopy(c.code)}
                  className="min-h-[44px] px-3.5 rounded-xl border border-neutral-200 text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5 hover:bg-neutral-50 cursor-pointer"
                >
                  {copiedCode === c.code ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode === c.code ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onApplyCoupon(c.code)}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#FFC928] text-[#111111] text-xs font-semibold hover:brightness-95 cursor-pointer"
                >
                  Apply on Ride
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-display text-lg font-bold text-[#111111]">Coupon Usage History</h2>
        {usageHistory.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 p-6 text-xs text-[#737373]">
            No coupons redeemed yet.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-neutral-200 divide-y divide-neutral-100">
            {usageHistory.map((u) => (
              <div key={u.id} className="p-4 flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-[#111111]">
                    {u.coupons?.code || 'Promo'} · {u.coupons?.title || 'Ride Discount'}
                  </p>
                  <p className="text-[#737373] font-mono-num">
                    {new Date(u.used_at).toLocaleString()}
                  </p>
                </div>
                <span className="font-mono-num font-bold text-[#16A34A]">
                  -₹{Number(u.discount_applied).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
