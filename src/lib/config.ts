import { AppConfig } from '../types/shinecab';

export async function loadAppConfig(): Promise<AppConfig> {
  return {
    googleMapsApiKey: '',
    supabaseUrl: 'https://://firebaseapp.com',
    supabaseAnonKey: 'firebase-connected',
    razorpayKeyId: '',
    appBaseUrl: window.location.origin,
    firebaseConfig: {
      apiKey: "AIzaSyBmhwmG-qcWl3sPXG0RFLCtvlfGzdcGG94",
      authDomain: "://firebaseapp.com",
      projectId: "shine-cab",
      storageBucket: "shine-cab.firebasestorage.app",
      messagingSenderId: "887888438839",
      appId: "1:887888438839:web:6f7a54f442c37c2b8201b2",
      measurementId: "G-EB52ZHGE75"
    },
    firebaseVapidKey: null,
    services: {
      maps: false,
      supabase: true,
      supabaseAdmin: true,
      razorpay: false,
      fcm: true,
    },
  };
}
