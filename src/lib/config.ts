import { AppConfig } from '../types/shinecab';

let cachedConfig: AppConfig | null = null;

export async function loadAppConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      cachedConfig = (await res.json()) as AppConfig;
      return cachedConfig;
    }
  } catch (err) {
    console.error('Failed to load runtime config:', err);
  }

  return {
    googleMapsApiKey: '',
    supabaseUrl: '',
    supabaseAnonKey: "firebase-connected",
    razorpayKeyId: '',
    appBaseUrl: window.location.origin,
    firebaseConfig: null,
    firebaseVapidKey: null,
    services: {
      maps: false,
      supabase: false,
      supabaseAdmin: false,
      razorpay: false,
      fcm: false,
    },
  };
}
