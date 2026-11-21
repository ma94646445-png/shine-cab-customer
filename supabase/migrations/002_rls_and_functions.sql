-- SHINE CAB — Migration 002: Row Level Security (RLS), Atomic Functions & Realtime

-- Helper: get current authenticated customer_id
CREATE OR REPLACE FUNCTION public.current_customer_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.customers WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Helper: get current authenticated driver_id
CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.drivers WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Enable RLS on all 22 tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fare_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_rides ENABLE ROW LEVEL SECURITY;

-- Public catalog policies (vehicle_categories, fare_settings, active coupons)
CREATE POLICY "vehicle_categories_read" ON public.vehicle_categories
  FOR SELECT TO authenticated, anon USING (is_active = TRUE);

CREATE POLICY "fare_settings_read" ON public.fare_settings
  FOR SELECT TO authenticated, anon USING (is_active = TRUE);

CREATE POLICY "coupons_read" ON public.coupons
  FOR SELECT TO authenticated USING (is_active = TRUE AND expires_at > NOW());

-- users: own record + driver public name/avatar only when assigned to customer's active/past ride
CREATE POLICY "users_own_read" ON public.users
  FOR SELECT TO authenticated USING (
    id = auth.uid()
    OR id IN (
      SELECT d.user_id FROM public.drivers d
      JOIN public.rides r ON r.driver_id = d.id
      WHERE r.customer_id = public.current_customer_id()
    )
  );

CREATE POLICY "users_own_update" ON public.users
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "users_own_insert" ON public.users
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- customers: strictly own profile
CREATE POLICY "customers_own_all" ON public.customers
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- drivers: customer can ONLY read driver profile for rides assigned to them
CREATE POLICY "drivers_assigned_ride_read" ON public.drivers
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR id IN (
      SELECT driver_id FROM public.rides
      WHERE customer_id = public.current_customer_id() AND driver_id IS NOT NULL
    )
  );

-- driver_documents: NEVER accessible to customers (only owning driver or service_role)
CREATE POLICY "driver_documents_owner_only" ON public.driver_documents
  FOR SELECT TO authenticated USING (driver_id = public.current_driver_id());

-- vehicles: customer can ONLY read vehicle attached to their assigned ride
CREATE POLICY "vehicles_assigned_ride_read" ON public.vehicles
  FOR SELECT TO authenticated USING (
    driver_id = public.current_driver_id()
    OR id IN (
      SELECT vehicle_id FROM public.rides
      WHERE customer_id = public.current_customer_id() AND vehicle_id IS NOT NULL
    )
  );

-- rides: customers only read/insert their own rides
CREATE POLICY "rides_customer_select" ON public.rides
  FOR SELECT TO authenticated USING (customer_id = public.current_customer_id() OR driver_id = public.current_driver_id());

CREATE POLICY "rides_customer_insert" ON public.rides
  FOR INSERT TO authenticated WITH CHECK (customer_id = public.current_customer_id());

-- ride_locations & ride_tracking: strictly scoped to customer/driver of that ride
CREATE POLICY "ride_locations_participant_read" ON public.ride_locations
  FOR SELECT TO authenticated USING (
    ride_id IN (SELECT id FROM public.rides WHERE customer_id = public.current_customer_id() OR driver_id = public.current_driver_id())
  );

CREATE POLICY "ride_tracking_participant_read" ON public.ride_tracking
  FOR SELECT TO authenticated USING (
    ride_id IN (
      SELECT id FROM public.rides
      WHERE (customer_id = public.current_customer_id() OR driver_id = public.current_driver_id())
        AND status IN ('driver_assigned', 'driver_arriving', 'driver_reached_pickup', 'otp_verification', 'ride_started')
    )
  );

-- payments & payment_events: strictly own customer records
CREATE POLICY "payments_customer_read" ON public.payments
  FOR SELECT TO authenticated USING (customer_id = public.current_customer_id());

CREATE POLICY "payment_events_customer_read" ON public.payment_events
  FOR SELECT TO authenticated USING (
    payment_id IN (SELECT id FROM public.payments WHERE customer_id = public.current_customer_id())
  );

-- coupon_usage, ratings, saved_addresses, emergency_contacts, sos_alerts, scheduled_rides
CREATE POLICY "coupon_usage_customer_read" ON public.coupon_usage
  FOR SELECT TO authenticated USING (customer_id = public.current_customer_id());

CREATE POLICY "ratings_customer_all" ON public.ratings
  FOR ALL TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

CREATE POLICY "saved_addresses_customer_all" ON public.saved_addresses
  FOR ALL TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

CREATE POLICY "emergency_contacts_customer_all" ON public.emergency_contacts
  FOR ALL TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

CREATE POLICY "sos_alerts_customer_all" ON public.sos_alerts
  FOR ALL TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

CREATE POLICY "scheduled_rides_customer_all" ON public.scheduled_rides
  FOR ALL TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

-- notifications: strictly own user_id
CREATE POLICY "notifications_own_all" ON public.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- support_tickets & support_messages
CREATE POLICY "support_tickets_customer_all" ON public.support_tickets
  FOR ALL TO authenticated
  USING (customer_id = public.current_customer_id())
  WITH CHECK (customer_id = public.current_customer_id());

CREATE POLICY "support_messages_customer_all" ON public.support_messages
  FOR ALL TO authenticated
  USING (ticket_id IN (SELECT id FROM public.support_tickets WHERE customer_id = public.current_customer_id()))
  WITH CHECK (ticket_id IN (SELECT id FROM public.support_tickets WHERE customer_id = public.current_customer_id()));

-- Atomic Ride Acceptance Function (prevents duplicate acceptance / double booking)
CREATE OR REPLACE FUNCTION public.accept_ride_atomic(
  p_ride_id UUID,
  p_driver_id UUID,
  p_vehicle_id UUID
)
RETURNS TABLE(accepted BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  -- Ensure driver is approved, verified, online, available, and not already on an active ride
  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
    JOIN public.vehicles v ON v.driver_id = d.id AND v.id = p_vehicle_id
    WHERE d.id = p_driver_id
      AND d.approval_status = 'approved'
      AND d.is_verified = TRUE
      AND d.is_online = TRUE
      AND d.is_available = TRUE
      AND v.is_active = TRUE
      AND v.documents_verified = TRUE
  ) THEN
    RETURN QUERY SELECT FALSE, 'Driver or vehicle is not eligible or unavailable';
    RETURN;
  END IF;

  -- Lock & update ride atomically only if still searching_driver
  UPDATE public.rides
  SET
    driver_id = p_driver_id,
    vehicle_id = p_vehicle_id,
    status = 'driver_assigned',
    updated_at = NOW()
  WHERE id = p_ride_id
    AND status = 'searching_driver'
    AND driver_id IS NULL
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Ride already assigned or no longer searching';
    RETURN;
  END IF;

  UPDATE public.drivers
  SET is_available = FALSE, updated_at = NOW()
  WHERE id = p_driver_id;

  RETURN QUERY SELECT TRUE, 'Ride assigned atomically';
END;
$$;

-- Enable Supabase Realtime on live tables
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_tracking;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
