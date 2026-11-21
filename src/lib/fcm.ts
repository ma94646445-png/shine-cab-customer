import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { AppConfig } from '../types/shinecab';

export async function registerFcmPushNotifications(
  config: AppConfig,
  onForegroundMessage: (title: string, body: string, deepLink?: string) => void
): Promise<string | null> {
  if (!config.services.fcm || !config.firebaseConfig || !config.firebaseVapidKey) {
    return null;
  }

  try {
    const supported = await isSupported();
    if (!supported || !('Notification' in window)) return null;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const app = getApps().length > 0 ? getApps()[0] : initializeApp(config.firebaseConfig);
    const messaging = getMessaging(app);

    let registration: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator) {
      registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      registration.active?.postMessage({
        type: 'INIT_FIREBASE_MESSAGING',
        config: config.firebaseConfig,
      });
    }

    const token = await getToken(messaging, {
      vapidKey: config.firebaseVapidKey,
      serviceWorkerRegistration: registration,
    });

    onMessage(messaging, (payload) => {
      onForegroundMessage(
        payload.notification?.title || 'SHINE CAB',
        payload.notification?.body || '',
        payload.data?.deep_link
      );
    });

    return token || null;
  } catch (err) {
    console.error('FCM registration error:', err);
    return null;
  }
}
