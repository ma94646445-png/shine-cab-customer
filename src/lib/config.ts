import { AppConfig } from '../types/shinecab';
import { firebaseAppletConfig } from './firebase';

let cachedConfig: AppConfig | null = null;

export async function loadAppConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;

  const envMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const defaults: AppConfig = {
    googleMapsApiKey: envMapsKey,
    supabaseUrl: '',
    supabaseAnonKey: '',
    razorpayKeyId: '',
    appBaseUrl: typeof window !== 'undefined' ? window.location.origin : '',
    firebaseConfig: {
      apiKey: firebaseAppletConfig.apiKey,
      projectId: firebaseAppletConfig.projectId,
      messagingSenderId: firebaseAppletConfig.messagingSenderId,
      appId: firebaseAppletConfig.appId,
    },
    firebaseVapidKey: null,
    services: {
      maps: Boolean(envMapsKey),
      supabase: true,
      supabaseAdmin: true,
      razorpay: false,
      fcm: Boolean(firebaseAppletConfig.messagingSenderId),
    },
  };

  try {
    const res = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const serverCfg = (await res.json()) as Partial<AppConfig>;
      const resolvedMapsKey = serverCfg.googleMapsApiKey || envMapsKey || defaults.googleMapsApiKey;
      cachedConfig = {
        ...defaults,
        googleMapsApiKey: resolvedMapsKey,
        razorpayKeyId: serverCfg.razorpayKeyId || defaults.razorpayKeyId,
        firebaseVapidKey: serverCfg.firebaseVapidKey || defaults.firebaseVapidKey,
        services: {
          ...defaults.services,
          maps: Boolean(serverCfg.services?.maps || resolvedMapsKey),
          razorpay: Boolean(serverCfg.services?.razorpay),
          fcm: Boolean(defaults.services.fcm && serverCfg.firebaseVapidKey),
        },
      };
      return cachedConfig;
    }
  } catch {
    // Android WebView / static SPA mode: never throw on /api/config
  }

  cachedConfig = defaults;
  return cachedConfig;
}
