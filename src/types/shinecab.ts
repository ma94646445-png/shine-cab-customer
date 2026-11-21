export type VehicleSlug = 'bike' | 'auto' | 'cab';

export type RideStatus =
  | 'searching_driver'
  | 'driver_assigned'
  | 'driver_arriving'
  | 'driver_reached_pickup'
  | 'otp_verification'
  | 'ride_started'
  | 'ride_completed'
  | 'payment_pending'
  | 'payment_completed'
  | 'cancelled'
  | 'failed';

export type PaymentMethod = 'cash' | 'upi' | 'online' | 'card';

export interface AppConfig {
  googleMapsApiKey: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  razorpayKeyId: string;
  appBaseUrl: string;
  firebaseConfig: {
    apiKey: string;
    projectId: string;
    messagingSenderId: string;
    appId: string;
  } | null;
  firebaseVapidKey: string | null;
  services: {
    maps: boolean;
    supabase: boolean;
    supabaseAdmin: boolean;
    razorpay: boolean;
    fcm: boolean;
  };
}

export interface LocationPoint {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

export interface FareEstimate {
  categoryId: string;
  slug: VehicleSlug;
  name: string;
  description: string;
  capacity: number;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  nightFare: number;
  surgeFare: number;
  platformFee: number;
  taxAmount: number;
  discountAmount: number;
  totalFare: number;
  surgeMultiplier: number;
  cancellationFee: number;
  availableDrivers: number;
  perKmRate?: number;
  isStandardTariff?: boolean;
}

export interface UserProfile {
  id: string;
  phone: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  language_preference: string;
  created_at?: string;
}

export interface CustomerProfile {
  id: string;
  user_id: string;
  preferred_payment_method: PaymentMethod;
  notification_push_enabled: boolean;
  notification_sms_enabled: boolean;
  notification_promo_enabled: boolean;
  fcm_token: string | null;
  total_rides: number;
  rating_avg: number;
}

export interface AssignedDriverInfo {
  id: string;
  rating_avg: number;
  current_lat: number | null;
  current_lng: number | null;
  current_heading: number | null;
  users?: {
    full_name: string | null;
    avatar_url: string | null;
    phone: string;
  } | null;
}

export interface AssignedVehicleInfo {
  id: string;
  make: string;
  model: string;
  color: string;
  registration_number: string;
}

export interface RideRecord {
  id: string;
  ride_code: string;
  customer_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  category_id: string;
  status: RideStatus;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  encoded_polyline: string | null;
  distance_meters: number;
  duration_seconds: number;
  base_fare: number;
  distance_fare: number;
  time_fare: number;
  waiting_fare: number;
  night_fare: number;
  surge_fare: number;
  platform_fee: number;
  tax_amount: number;
  discount_amount: number;
  cancellation_fee: number;
  total_fare: number;
  payment_method: PaymentMethod;
  payment_status: 'pending' | 'pending_collection' | 'paid' | 'failed' | 'refunded';
  ride_otp: string;
  share_token: string;
  cancellation_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  vehicle_categories?: { name: string; slug: VehicleSlug } | null;
  drivers?: AssignedDriverInfo | null;
  vehicles?: AssignedVehicleInfo | null;
  ratings?: { id: string; overall_rating: number; feedback: string | null }[] | null;
}

export interface RideTrackingPoint {
  id: string;
  ride_id: string;
  driver_id: string;
  lat: number;
  lng: number;
  heading: number;
  speed_kmh: number;
  eta_seconds: number | null;
  distance_remaining_meters: number | null;
  recorded_at: string;
}

export interface SavedAddress {
  id: string;
  label: string;
  address_type: 'home' | 'office' | 'other';
  address_line: string;
  place_id: string | null;
  lat: number;
  lng: number;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
  is_primary: boolean;
}

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description: string;
  discount_type: 'percentage' | 'flat';
  discount_value: number;
  min_ride_amount: number;
  max_discount: number | null;
  first_ride_only: boolean;
  applicable_category_slug: VehicleSlug | null;
  expires_at: string;
}

export interface PaymentRecord {
  id: string;
  ride_id: string;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  provider: 'razorpay' | 'cash';
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  status: string;
  receipt_number: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface NotificationRecord {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  deep_link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  ticket_number: string;
  ride_id: string | null;
  category: 'ride' | 'payment' | 'driver' | 'lost_item' | 'safety' | 'account' | 'other';
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  created_at: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: 'customer' | 'admin';
  message: string;
  created_at: string;
}

export interface ScheduledRide {
  id: string;
  category_id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  scheduled_for: string;
  estimated_fare: number;
  distance_meters: number;
  duration_seconds: number;
  payment_method: PaymentMethod;
  status: 'scheduled' | 'dispatching' | 'assigned' | 'converted_to_ride' | 'cancelled' | 'expired';
  ride_id: string | null;
  created_at: string;
  vehicle_categories?: { name: string; slug: VehicleSlug } | null;
}

export interface NearbyDriverDetail {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  phone: string;
  ratingAvg: number;
  categoryId: string;
  categoryName: string;
  slug: VehicleSlug;
  vehicle: {
    id: string;
    make: string;
    model: string;
    color: string;
    registrationNumber: string;
  };
  lat: number;
  lng: number;
  heading: number;
  distanceKm: number;
  etaMinutes: number;
}

export interface RideMessage {
  id: string;
  ride_id: string;
  sender_user_id: string;
  sender_role: 'customer' | 'driver';
  message: string;
  created_at: string;
}

export interface SosAlertRecord {
  id: string;
  ride_id: string | null;
  customer_id: string;
  lat: number | null;
  lng: number | null;
  message: string | null;
  status: 'dispatched' | 'acknowledged' | 'resolved';
  dispatched_to: string[];
  resolved_at: string | null;
  created_at: string;
}

