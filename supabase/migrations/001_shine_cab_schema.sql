-- SHINE CAB — Production PostgreSQL / Supabase Migration 001
-- Core Schema: All 22 tables with UUID PKs, FKs, timestamps, constraints, and indexes

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. users (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'driver', 'admin')),
  language_preference TEXT NOT NULL DEFAULT 'en',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. customers
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  preferred_payment_method TEXT NOT NULL DEFAULT 'upi' CHECK (preferred_payment_method IN ('cash', 'upi', 'online', 'card')),
  notification_push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notification_sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notification_promo_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  fcm_token TEXT,
  total_rides INTEGER NOT NULL DEFAULT 0,
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 5.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. vehicle_categories
CREATE TABLE IF NOT EXISTS public.vehicle_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL CHECK (slug IN ('bike', 'auto', 'cab')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. drivers
CREATE TABLE IF NOT EXISTS public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.vehicle_categories(id),
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'suspended', 'rejected')),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  current_heading DOUBLE PRECISION DEFAULT 0,
  last_location_at TIMESTAMPTZ,
  service_city TEXT,
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 5.00,
  total_trips INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drivers_matching
  ON public.drivers (category_id, approval_status, is_verified, is_online, is_available);

-- 5. driver_documents (strictly restricted — never readable by customers)
CREATE TABLE IF NOT EXISTS public.driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('driving_license', 'rc_book', 'insurance', 'aadhaar', 'pan', 'permit')),
  document_number TEXT NOT NULL,
  document_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_at TIMESTAMPTZ,
  expires_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON public.driver_documents (driver_id);

-- 6. vehicles
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.vehicle_categories(id),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT NOT NULL,
  registration_number TEXT UNIQUE NOT NULL,
  year INTEGER,
  documents_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON public.vehicles (driver_id, is_active);

-- 7. fare_settings (admin-controlled pricing rules per category)
CREATE TABLE IF NOT EXISTS public.fare_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.vehicle_categories(id) ON DELETE CASCADE,
  city TEXT NOT NULL DEFAULT 'default',
  base_fare NUMERIC(10,2) NOT NULL CHECK (base_fare >= 0),
  per_km_rate NUMERIC(10,2) NOT NULL CHECK (per_km_rate >= 0),
  per_minute_rate NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (per_minute_rate >= 0),
  minimum_fare NUMERIC(10,2) NOT NULL CHECK (minimum_fare >= 0),
  waiting_charge_per_min NUMERIC(10,2) NOT NULL DEFAULT 0,
  free_waiting_minutes INTEGER NOT NULL DEFAULT 3,
  night_charge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  night_start_hour INTEGER NOT NULL DEFAULT 23,
  night_end_hour INTEGER NOT NULL DEFAULT 5,
  surge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_percentage NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  cancellation_fee NUMERIC(10,2) NOT NULL DEFAULT 25.00,
  search_radius_km NUMERIC(6,2) NOT NULL DEFAULT 8.00,
  matching_timeout_sec INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, city)
);

-- 8. coupons
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  min_ride_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount NUMERIC(10,2),
  usage_limit_total INTEGER,
  usage_limit_per_user INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  first_ride_only BOOLEAN NOT NULL DEFAULT FALSE,
  applicable_category_slug TEXT CHECK (applicable_category_slug IN ('bike', 'auto', 'cab')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. rides
CREATE TABLE IF NOT EXISTS public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_code TEXT UNIQUE NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  driver_id UUID REFERENCES public.drivers(id),
  vehicle_id UUID REFERENCES public.vehicles(id),
  category_id UUID NOT NULL REFERENCES public.vehicle_categories(id),
  status TEXT NOT NULL DEFAULT 'searching_driver' CHECK (
    status IN (
      'searching_driver',
      'driver_assigned',
      'driver_arriving',
      'driver_reached_pickup',
      'otp_verification',
      'ride_started',
      'ride_completed',
      'payment_pending',
      'payment_completed',
      'cancelled',
      'failed'
    )
  ),
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  drop_address TEXT NOT NULL,
  drop_lat DOUBLE PRECISION NOT NULL,
  drop_lng DOUBLE PRECISION NOT NULL,
  encoded_polyline TEXT,
  distance_meters INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  base_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  distance_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  time_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  waiting_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  night_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  surge_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  cancellation_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_fare NUMERIC(10,2) NOT NULL DEFAULT 0,
  coupon_id UUID REFERENCES public.coupons(id),
  payment_method TEXT NOT NULL DEFAULT 'upi' CHECK (payment_method IN ('cash', 'upi', 'online', 'card')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'pending_collection', 'paid', 'failed', 'refunded')),
  ride_otp TEXT NOT NULL,
  otp_verified_at TIMESTAMPTZ,
  cancelled_by TEXT CHECK (cancelled_by IN ('customer', 'driver', 'system')),
  cancellation_reason TEXT,
  matching_expires_at TIMESTAMPTZ,
  rejected_driver_ids UUID[] NOT NULL DEFAULT '{}',
  share_token UUID NOT NULL DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rides_customer ON public.rides (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON public.rides (driver_id, status);
CREATE INDEX IF NOT EXISTS idx_rides_status ON public.rides (status, created_at DESC);

-- 10. ride_locations (waypoints & status location snapshots)
CREATE TABLE IF NOT EXISTS public.ride_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  location_type TEXT NOT NULL CHECK (location_type IN ('pickup', 'drop', 'waypoint', 'driver_accept', 'driver_arrived', 'ride_start', 'ride_end')),
  address TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ride_locations_ride ON public.ride_locations (ride_id, recorded_at);

-- 11. ride_tracking (real-time GPS telemetry stream for active rides)
CREATE TABLE IF NOT EXISTS public.ride_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION DEFAULT 0,
  speed_kmh DOUBLE PRECISION DEFAULT 0,
  eta_seconds INTEGER,
  distance_remaining_meters INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ride_tracking_ride ON public.ride_tracking (ride_id, recorded_at DESC);

-- 12. payments
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'online', 'card')),
  provider TEXT NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay', 'cash')),
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_signature TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending_collection', 'authorized', 'captured', 'failed', 'refund_requested', 'refunded')),
  failure_reason TEXT,
  receipt_number TEXT UNIQUE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_ride ON public.payments (ride_id);

-- 13. payment_events (immutable audit ledger)
CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  provider_event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON public.payment_events (payment_id, created_at DESC);

-- 14. coupon_usage
CREATE TABLE IF NOT EXISTS public.coupon_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  discount_applied NUMERIC(10,2) NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, ride_id)
);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_customer ON public.coupon_usage (customer_id, coupon_id);

-- 15. ratings (one rating per ride enforced by UNIQUE)
CREATE TABLE IF NOT EXISTS public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL UNIQUE REFERENCES public.rides(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  driver_behavior_rating INTEGER NOT NULL CHECK (driver_behavior_rating BETWEEN 1 AND 5),
  vehicle_cleanliness_rating INTEGER NOT NULL CHECK (vehicle_cleanliness_rating BETWEEN 1 AND 5),
  experience_rating INTEGER NOT NULL CHECK (experience_rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ratings_driver ON public.ratings (driver_id, created_at DESC);

-- 16. saved_addresses
CREATE TABLE IF NOT EXISTS public.saved_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address_type TEXT NOT NULL DEFAULT 'other' CHECK (address_type IN ('home', 'office', 'other')),
  address_line TEXT NOT NULL,
  place_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_addresses_customer ON public.saved_addresses (customer_id);

-- 17. emergency_contacts
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relationship TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_customer ON public.emergency_contacts (customer_id);

-- 18. sos_alerts
CREATE TABLE IF NOT EXISTS public.sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched', 'acknowledged', 'resolved')),
  dispatched_to TEXT[] NOT NULL DEFAULT '{}',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_customer ON public.sos_alerts (customer_id, created_at DESC);

-- 19. notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (
    notification_type IN (
      'otp', 'booking_confirmation', 'driver_assigned', 'driver_arriving',
      'driver_reached_pickup', 'ride_started', 'ride_completed',
      'payment_confirmation', 'ride_cancellation', 'refund_update',
      'promotional_offer', 'support_update', 'sos_alert'
    )
  ),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, is_read, created_at DESC);

-- 20. support_tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('ride', 'payment', 'driver', 'lost_item', 'safety', 'account', 'other')),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON public.support_tickets (customer_id, created_at DESC);

-- 21. support_messages
CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'admin')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON public.support_messages (ticket_id, created_at ASC);

-- 22. scheduled_rides
CREATE TABLE IF NOT EXISTS public.scheduled_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.vehicle_categories(id),
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  drop_address TEXT NOT NULL,
  drop_lat DOUBLE PRECISION NOT NULL,
  drop_lng DOUBLE PRECISION NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  estimated_fare NUMERIC(10,2) NOT NULL,
  distance_meters INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'upi' CHECK (payment_method IN ('cash', 'upi', 'online', 'card')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'dispatching', 'assigned', 'converted_to_ride', 'cancelled', 'expired')),
  ride_id UUID REFERENCES public.rides(id),
  reminder_sent_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_rides_customer ON public.scheduled_rides (customer_id, scheduled_for ASC);
