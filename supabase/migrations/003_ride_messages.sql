-- SHINE CAB — Migration 003: Real-time Ride Messages for Customer-Driver Chat

CREATE TABLE IF NOT EXISTS public.ride_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'driver')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ride_messages_ride
  ON public.ride_messages (ride_id, created_at ASC);

ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ride_messages_participant_all" ON public.ride_messages
  FOR ALL TO authenticated
  USING (
    ride_id IN (
      SELECT id FROM public.rides
      WHERE customer_id = public.current_customer_id()
         OR driver_id = public.current_driver_id()
    )
  )
  WITH CHECK (
    sender_user_id = auth.uid()
    AND ride_id IN (
      SELECT id FROM public.rides
      WHERE customer_id = public.current_customer_id()
         OR driver_id = public.current_driver_id()
    )
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
