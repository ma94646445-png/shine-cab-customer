import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// Environment configuration getters (never expose secrets to client)
function getEnvConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '';
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || '';
  const firebaseSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID || '';
  const firebaseApiKey = process.env.FIREBASE_API_KEY || '';
  const firebaseAppId = process.env.FIREBASE_APP_ID || '';
  const firebaseVapidKey = process.env.FIREBASE_VAPID_KEY || '';
  const firebaseServerKey = process.env.FIREBASE_SERVER_KEY || '';
  const appBaseUrl = process.env.APP_BASE_URL || process.env.APP_URL || '';

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    googleMapsApiKey,
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    firebaseProjectId,
    firebaseSenderId,
    firebaseApiKey,
    firebaseAppId,
    firebaseVapidKey,
    firebaseServerKey,
    appBaseUrl,
  };
}

function createSupabaseAdmin(): SupabaseClient | null {
  const cfg = getEnvConfig();
  if (!cfg.supabaseUrl || !(cfg.supabaseServiceKey || cfg.supabaseAnonKey)) {
    return null;
  }
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceKey || cfg.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Haversine distance in kilometers
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Simple sliding-window rate limiter per IP
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxRequests = 120, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again.' });
    }
    return next();
  };
}

interface AuthedRequest extends Request {
  authUser?: User;
  customerId?: string;
  supabaseUserClient?: SupabaseClient;
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const cfg = getEnvConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return res.status(503).json({
      error: 'Service configuration required. Please contact support.',
      code: 'SUPABASE_NOT_CONFIGURED',
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const userClient = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }

  req.authUser = data.user;
  req.supabaseUserClient = userClient;

  // Resolve or provision customer profile row cleanly
  const admin = createSupabaseAdmin();
  const db = admin || userClient;
  const { data: customerRow } = await db
    .from('customers')
    .select('id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (customerRow?.id) {
    req.customerId = customerRow.id;
  } else if (admin) {
    // Ensure users + customers record exists for newly verified OTP user
    await admin.from('users').upsert(
      {
        id: data.user.id,
        phone: data.user.phone || data.user.email || data.user.id,
        email: data.user.email || null,
        role: 'customer',
      },
      { onConflict: 'id' }
    );
    const { data: createdCustomer } = await admin
      .from('customers')
      .upsert({ user_id: data.user.id }, { onConflict: 'user_id' })
      .select('id')
      .single();
    if (createdCustomer?.id) {
      req.customerId = createdCustomer.id;
    }
  }

  return next();
}

// Module-scoped WebSocket rooms for real-time notifications, driver dispatch, and ride chat
const wsRooms = new Map<string, Set<WebSocket>>();

function broadcastChannel(channel: string, event: string, payload: unknown) {
  const clients = wsRooms.get(channel);
  if (!clients) return;
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Send FCM Push Notification if configured + persist to notifications table + broadcast live over WS
async function dispatchNotification(params: {
  admin: SupabaseClient;
  userId: string;
  type: string;
  title: string;
  body: string;
  deepLink?: string;
  metadata?: Record<string, unknown>;
}) {
  const { admin, userId, type, title, body, deepLink, metadata } = params;
  const { data: inserted } = await admin
    .from('notifications')
    .insert({
      user_id: userId,
      notification_type: type,
      title,
      body,
      deep_link: deepLink || '/',
      metadata: metadata || {},
    })
    .select('*')
    .maybeSingle();

  if (inserted) {
    broadcastChannel(`user:${userId}`, 'notification:new', inserted);
  }

  const cfg = getEnvConfig();
  if (!cfg.firebaseServerKey) return;

  const { data: customer } = await admin
    .from('customers')
    .select('fcm_token, notification_push_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (!customer?.fcm_token || customer.notification_push_enabled === false) return;

  try {
    await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${cfg.firebaseServerKey}`,
      },
      body: JSON.stringify({
        to: customer.fcm_token,
        notification: { title, body },
        data: { deep_link: deepLink || '/', type, ...(metadata || {}) },
      }),
    });
  } catch (err) {
    console.error('FCM dispatch error:', err);
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // WebSocket server for real-time ride/tracking/notification/chat channels
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    const joinedRooms = new Set<string>();
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'subscribe' && typeof msg.channel === 'string') {
          const nextRoom: string = msg.channel;
          if (!wsRooms.has(nextRoom)) wsRooms.set(nextRoom, new Set());
          wsRooms.get(nextRoom)!.add(ws);
          joinedRooms.add(nextRoom);
        } else if (msg.type === 'unsubscribe' && typeof msg.channel === 'string') {
          wsRooms.get(msg.channel)?.delete(ws);
          joinedRooms.delete(msg.channel);
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('close', () => {
      for (const room of joinedRooms) {
        wsRooms.get(room)?.delete(ws);
      }
      joinedRooms.clear();
    });
  });

  // Razorpay webhook needs raw body for HMAC verification
  app.post(
    '/api/webhooks/razorpay',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const cfg = getEnvConfig();
      if (!cfg.razorpayWebhookSecret) {
        return res.status(503).json({ error: 'Razorpay webhook secret not configured.' });
      }
      const signature = req.headers['x-razorpay-signature'];
      if (typeof signature !== 'string') {
        return res.status(400).json({ error: 'Missing X-Razorpay-Signature header.' });
      }
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', cfg.razorpayWebhookSecret)
        .update(rawBody)
        .digest('hex');

      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return res.status(400).json({ error: 'Invalid webhook signature.' });
      }

      const admin = createSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
      }

      try {
        const event = JSON.parse(rawBody);
        const eventName = event.event as string;
        const paymentEntity = event.payload?.payment?.entity;
        const orderId = paymentEntity?.order_id as string | undefined;
        const paymentId = paymentEntity?.id as string | undefined;

        if (orderId) {
          const { data: paymentRow } = await admin
            .from('payments')
            .select('id, ride_id, customer_id, status')
            .eq('razorpay_order_id', orderId)
            .maybeSingle();

          if (paymentRow) {
            await admin.from('payment_events').insert({
              payment_id: paymentRow.id,
              event_type: `webhook:${eventName}`,
              provider_event_id: paymentId || null,
              payload: event,
            });

            if (eventName === 'payment.captured' && paymentRow.status !== 'captured') {
              await admin
                .from('payments')
                .update({
                  status: 'captured',
                  razorpay_payment_id: paymentId || null,
                  paid_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', paymentRow.id);

              await admin
                .from('rides')
                .update({
                  payment_status: 'paid',
                  status: 'payment_completed',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', paymentRow.ride_id);
            } else if (eventName === 'payment.failed') {
              await admin
                .from('payments')
                .update({
                  status: 'failed',
                  failure_reason: paymentEntity?.error_description || 'Payment failed',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', paymentRow.id);
            }
          }
        }
        return res.json({ received: true });
      } catch (err) {
        console.error('Razorpay webhook processing error:', err);
        return res.status(500).json({ error: 'Webhook processing error.' });
      }
    }
  );

  app.use(express.json({ limit: '10mb' }));
  app.use('/api', rateLimit(150, 60_000));

  // Public runtime configuration (never returns secret keys!)
  app.get('/api/config', (_req: Request, res: Response) => {
    const cfg = getEnvConfig();
    const supabaseConfigured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
    const mapsConfigured = Boolean(cfg.googleMapsApiKey);
    const razorpayConfigured = Boolean(cfg.razorpayKeyId && cfg.razorpayKeySecret);
    const fcmConfigured = Boolean(cfg.firebaseProjectId && cfg.firebaseSenderId && cfg.firebaseApiKey && cfg.firebaseAppId);

    res.json({
      googleMapsApiKey: cfg.googleMapsApiKey,
      supabaseUrl: cfg.supabaseUrl,
      supabaseAnonKey: cfg.supabaseAnonKey,
      razorpayKeyId: cfg.razorpayKeyId,
      appBaseUrl: cfg.appBaseUrl,
      firebaseConfig: fcmConfigured
        ? {
            apiKey: cfg.firebaseApiKey,
            projectId: cfg.firebaseProjectId,
            messagingSenderId: cfg.firebaseSenderId,
            appId: cfg.firebaseAppId,
          }
        : null,
      firebaseVapidKey: cfg.firebaseVapidKey || null,
      services: {
        maps: mapsConfigured,
        supabase: supabaseConfigured,
        supabaseAdmin: Boolean(cfg.supabaseUrl && cfg.supabaseServiceKey),
        razorpay: razorpayConfigured,
        fcm: fcmConfigured,
      },
    });
  });

  // Server-side Geocoding Proxy (prevents browser CORS issues with Geocoding REST API)
  app.get('/api/maps/geocode', async (req: Request, res: Response) => {
    const cfg = getEnvConfig();
    if (!cfg.googleMapsApiKey) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }

    const { lat, lng, address, placeId } = req.query;
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    if (lat && lng) {
      url.searchParams.set('latlng', `${lat},${lng}`);
    } else if (typeof address === 'string' && address.trim()) {
      url.searchParams.set('address', address.trim());
    } else if (typeof placeId === 'string' && placeId.trim()) {
      url.searchParams.set('place_id', placeId.trim());
    } else {
      return res.status(400).json({ error: 'Provide lat & lng, address, or placeId.' });
    }
    url.searchParams.set('key', cfg.googleMapsApiKey);

    try {
      const response = await fetch(url.toString());
      const data = await response.json();
      if (response.status === 429 || data.status === 'OVER_QUERY_LIMIT') {
        return res.status(429).json({ error: 'RESOURCE_EXHAUSTED', status: 'RESOURCE_EXHAUSTED' });
      }
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        return res.status(502).json({ error: data.error_message || `Geocoding failed: ${data.status}` });
      }
      return res.json({ results: data.results || [], status: data.status });
    } catch (err) {
      console.error('Geocode proxy error:', err);
      return res.status(500).json({ error: 'Failed to reach Geocoding service.' });
    }
  });

  // Standard SHINE CAB Metered Tariff Table (used for transparent per-km fare calculation when DB fare_settings are not yet provisioned)
  const STANDARD_TARIFFS = [
    {
      categoryId: 'standard-bike',
      slug: 'bike' as const,
      name: 'Bike',
      description: 'Quick solo rides',
      capacity: 1,
      baseFare: 15,
      perKmRate: 7,
      perMinuteRate: 0.5,
      minimumFare: 25,
      platformFee: 2,
      taxPercentage: 5,
      cancellationFee: 15,
    },
    {
      categoryId: 'standard-auto',
      slug: 'auto' as const,
      name: 'Auto',
      description: 'Doorstep city travel',
      capacity: 3,
      baseFare: 25,
      perKmRate: 12,
      perMinuteRate: 0.75,
      minimumFare: 35,
      platformFee: 3,
      taxPercentage: 5,
      cancellationFee: 20,
    },
    {
      categoryId: 'standard-cab',
      slug: 'cab' as const,
      name: 'Cab',
      description: 'AC comfort rides',
      capacity: 4,
      baseFare: 45,
      perKmRate: 16,
      perMinuteRate: 1.2,
      minimumFare: 70,
      platformFee: 5,
      taxPercentage: 5,
      cancellationFee: 35,
    },
  ];

  function buildStandardEstimates(distanceMeters: number, durationSeconds: number) {
    const km = distanceMeters / 1000;
    const mins = durationSeconds / 60;
    return STANDARD_TARIFFS.map((t) => {
      const distanceFare = Number((km * t.perKmRate).toFixed(2));
      const timeFare = Number((mins * t.perMinuteRate).toFixed(2));
      const subtotal = Math.max(t.minimumFare, t.baseFare + distanceFare + timeFare);
      const preTax = subtotal + t.platformFee;
      const taxAmount = Number(((preTax * t.taxPercentage) / 100).toFixed(2));
      const totalFare = Number((preTax + taxAmount).toFixed(2));
      return {
        categoryId: t.categoryId,
        slug: t.slug,
        name: t.name,
        description: t.description,
        capacity: t.capacity,
        baseFare: t.baseFare,
        distanceFare,
        timeFare,
        nightFare: 0,
        surgeFare: 0,
        platformFee: t.platformFee,
        taxAmount,
        discountAmount: 0,
        totalFare,
        surgeMultiplier: 1,
        cancellationFee: t.cancellationFee,
        availableDrivers: 0,
        perKmRate: t.perKmRate,
        isStandardTariff: true,
      };
    });
  }

  // Home screen real summary: vehicle categories, starting fare rules, active offers, and real nearby drivers
  app.get('/api/vehicles/home-summary', async (req: Request, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin) {
      return res.json({
        configured: false,
        categories: STANDARD_TARIFFS.map((t) => ({
          id: t.categoryId,
          name: t.name,
          slug: t.slug,
          description: t.description,
          capacity: t.capacity,
          minimumFare: t.minimumFare,
          perKmRate: t.perKmRate,
          surgeMultiplier: 1,
          availableDrivers: 0,
        })),
        activeOffers: [],
        nearbyDrivers: [],
      });
    }

    const latParam = req.query.lat ? Number(req.query.lat) : null;
    const lngParam = req.query.lng ? Number(req.query.lng) : null;
    const hasCoords =
      latParam !== null &&
      lngParam !== null &&
      Number.isFinite(latParam) &&
      Number.isFinite(lngParam);

    try {
      const [{ data: categories }, { data: fares }, { data: drivers }, { data: offers }] =
        await Promise.all([
          admin
            .from('vehicle_categories')
            .select('id, name, slug, description, capacity, sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          admin.from('fare_settings').select('*').eq('is_active', true),
          admin
            .from('drivers')
            .select('id, category_id, current_lat, current_lng, current_heading')
            .eq('approval_status', 'approved')
            .eq('is_verified', true)
            .eq('is_online', true)
            .eq('is_available', true),
          admin
            .from('coupons')
            .select(
              'id, code, title, description, discount_type, discount_value, min_ride_amount, max_discount, first_ride_only, applicable_category_slug, expires_at'
            )
            .eq('is_active', true)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(12),
        ]);

      const categoryMap = new Map<string, string>();
      (categories || []).forEach((c) => categoryMap.set(c.id, c.slug));

      const filteredDrivers = (drivers || [])
        .filter((d) => typeof d.current_lat === 'number' && typeof d.current_lng === 'number')
        .filter((d) => {
          if (!hasCoords) return true;
          return haversineKm(latParam!, lngParam!, Number(d.current_lat), Number(d.current_lng)) <= 10;
        })
        .slice(0, 25)
        .map((d) => ({
          id: d.id,
          categoryId: d.category_id,
          slug: categoryMap.get(d.category_id) || 'cab',
          lat: Number(d.current_lat),
          lng: Number(d.current_lng),
          heading: Number(d.current_heading || 0),
        }));

      const driverCounts = new Map<string, number>();
      filteredDrivers.forEach((d) => {
        driverCounts.set(d.categoryId, (driverCounts.get(d.categoryId) || 0) + 1);
      });

      const enrichedCategories = (categories || []).map((cat) => {
        const rule =
          fares?.find((f) => f.category_id === cat.id && f.city === 'default') ||
          fares?.find((f) => f.category_id === cat.id);
        return {
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          capacity: cat.capacity,
          minimumFare: rule ? Number(rule.minimum_fare) : null,
          perKmRate: rule ? Number(rule.per_km_rate) : null,
          surgeMultiplier: rule ? Number(rule.surge_multiplier) : 1,
          availableDrivers: driverCounts.get(cat.id) || 0,
        };
      });

      return res.json({
        configured: true,
        categories: enrichedCategories,
        activeOffers: offers || [],
        nearbyDrivers: filteredDrivers,
      });
    } catch (err) {
      console.error('Home summary error:', err);
      return res.status(500).json({ error: 'Unable to load vehicle categories.' });
    }
  });

  // Search Nearby Verified Online Drivers within radiusKm (strictly real DB drivers)
  app.get('/api/drivers/nearby', async (req: Request, res: Response) => {
    const admin = createSupabaseAdmin();
    const radiusKm = Math.min(25, Math.max(1, Number(req.query.radiusKm) || 5));
    if (!admin) {
      return res.json({
        configured: false,
        radiusKm,
        drivers: [],
      });
    }

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const categorySlug = typeof req.query.categorySlug === 'string' ? req.query.categorySlug : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Valid pickup lat and lng are required.' });
    }

    try {
      const { data: candidates, error: drvErr } = await admin
        .from('drivers')
        .select(
          `
          id, user_id, category_id, rating_avg, current_lat, current_lng, current_heading,
          users(full_name, avatar_url, phone),
          vehicle_categories(id, name, slug),
          vehicles!inner(id, make, model, color, registration_number, documents_verified, is_active)
        `
        )
        .eq('approval_status', 'approved')
        .eq('is_verified', true)
        .eq('is_online', true)
        .eq('is_available', true);

      if (drvErr) throw drvErr;

      const nearby = (candidates || [])
        .map((d: any) => {
          if (typeof d.current_lat !== 'number' || typeof d.current_lng !== 'number') return null;
          const activeVehicle = Array.isArray(d.vehicles)
            ? d.vehicles.find((v: any) => v.is_active && v.documents_verified)
            : null;
          if (!activeVehicle) return null;

          const cat = Array.isArray(d.vehicle_categories)
            ? d.vehicle_categories[0]
            : d.vehicle_categories;
          const slug = cat?.slug || 'cab';
          if (categorySlug && slug !== categorySlug) return null;

          const distanceKm = haversineKm(lat, lng, Number(d.current_lat), Number(d.current_lng));
          if (distanceKm > radiusKm) return null;

          const usr = Array.isArray(d.users) ? d.users[0] : d.users;
          return {
            id: d.id,
            userId: d.user_id,
            name: usr?.full_name || 'Verified Captain',
            avatarUrl: usr?.avatar_url || null,
            phone: usr?.phone || '',
            ratingAvg: Number(d.rating_avg || 5),
            categoryId: d.category_id,
            categoryName: cat?.name || 'Cab',
            slug,
            vehicle: {
              id: activeVehicle.id,
              make: activeVehicle.make,
              model: activeVehicle.model,
              color: activeVehicle.color,
              registrationNumber: activeVehicle.registration_number,
            },
            lat: Number(d.current_lat),
            lng: Number(d.current_lng),
            heading: Number(d.current_heading || 0),
            distanceKm: Number(distanceKm.toFixed(2)),
            etaMinutes: Math.max(1, Math.round((distanceKm / 24) * 60)),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 15);

      return res.json({
        configured: true,
        radiusKm,
        drivers: nearby,
      });
    } catch (err) {
      console.error('Nearby drivers error:', err);
      return res.status(500).json({ error: 'Unable to search nearby drivers right now.' });
    }
  });

  // Backend-controlled Fare Estimation (reads fare_settings + vehicle_categories + validates coupons, with deterministic standard tariff fallback)
  app.post('/api/fares/estimate', async (req: Request, res: Response) => {
    const { distanceMeters, durationSeconds, city = 'default', couponCode, customerId } = req.body || {};
    if (typeof distanceMeters !== 'number' || distanceMeters < 0 || typeof durationSeconds !== 'number' || durationSeconds < 0) {
      return res.status(400).json({ error: 'Valid distanceMeters and durationSeconds are required.' });
    }

    const admin = createSupabaseAdmin();
    if (!admin) {
      return res.json({
        estimates: buildStandardEstimates(distanceMeters, durationSeconds),
        appliedCoupon: null,
        couponError:
          typeof couponCode === 'string' && couponCode.trim()
            ? 'Promo validation requires Supabase backend configuration.'
            : null,
        pricingSource: 'standard_tariff',
        notice:
          'Showing standard per-km metered fare estimate. Configure Supabase backend for live captain dispatch & custom city rates.',
      });
    }

    try {
      const { data: categories, error: catErr } = await admin
        .from('vehicle_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (catErr) throw catErr;
      if (!categories || categories.length === 0) {
        return res.json({
          estimates: buildStandardEstimates(distanceMeters, durationSeconds),
          appliedCoupon: null,
          couponError: null,
          pricingSource: 'standard_tariff',
          notice: 'Showing standard per-km metered fare estimate.',
        });
      }

      const { data: fares, error: fareErr } = await admin
        .from('fare_settings')
        .select('*')
        .eq('is_active', true);

      if (fareErr) throw fareErr;

      // Check coupon if provided
      let validCoupon: Record<string, any> | null = null;
      let couponError: string | null = null;
      if (typeof couponCode === 'string' && couponCode.trim()) {
        const { data: coupon } = await admin
          .from('coupons')
          .select('*')
          .eq('code', couponCode.trim().toUpperCase())
          .eq('is_active', true)
          .maybeSingle();

        if (!coupon) {
          couponError = 'Invalid promo code.';
        } else if (new Date(coupon.expires_at) < new Date()) {
          couponError = 'This promo code has expired.';
        } else if (coupon.usage_limit_total && coupon.used_count >= coupon.usage_limit_total) {
          couponError = 'Promo code usage limit reached.';
        } else {
          if (customerId) {
            const { count } = await admin
              .from('coupon_usage')
              .select('id', { count: 'exact', head: true })
              .eq('coupon_id', coupon.id)
              .eq('customer_id', customerId);
            if ((count || 0) >= coupon.usage_limit_per_user) {
              couponError = 'You have already used this promo code.';
            }
            if (!couponError && coupon.first_ride_only) {
              const { count: rideCount } = await admin
                .from('rides')
                .select('id', { count: 'exact', head: true })
                .eq('customer_id', customerId)
                .eq('status', 'payment_completed');
              if ((rideCount || 0) > 0) {
                couponError = 'This offer is valid on your first ride only.';
              }
            }
          }
          if (!couponError) validCoupon = coupon;
        }
      }

      const km = distanceMeters / 1000;
      const mins = durationSeconds / 60;
      const currentHour = new Date().getHours();

      const estimates = [];
      for (const cat of categories) {
        const rule =
          fares?.find((f) => f.category_id === cat.id && f.city === city) ||
          fares?.find((f) => f.category_id === cat.id && f.city === 'default');

        if (!rule) continue;

        const baseFare = Number(rule.base_fare);
        const distanceFare = Number((km * Number(rule.per_km_rate)).toFixed(2));
        const timeFare = Number((mins * Number(rule.per_minute_rate)).toFixed(2));
        const subtotal = Math.max(Number(rule.minimum_fare), baseFare + distanceFare + timeFare);

        const isNight =
          rule.night_start_hour > rule.night_end_hour
            ? currentHour >= rule.night_start_hour || currentHour < rule.night_end_hour
            : currentHour >= rule.night_start_hour && currentHour < rule.night_end_hour;

        const nightFare = isNight
          ? Number((subtotal * (Number(rule.night_charge_multiplier) - 1)).toFixed(2))
          : 0;
        const surgeFare = Number((subtotal * (Number(rule.surge_multiplier) - 1)).toFixed(2));
        const platformFee = Number(rule.platform_fee || 0);
        const preTax = subtotal + nightFare + surgeFare + platformFee;
        const taxAmount = Number(((preTax * Number(rule.tax_percentage || 0)) / 100).toFixed(2));

        let discountAmount = 0;
        if (validCoupon && (!validCoupon.applicable_category_slug || validCoupon.applicable_category_slug === cat.slug)) {
          if (preTax >= Number(validCoupon.min_ride_amount || 0)) {
            discountAmount =
              validCoupon.discount_type === 'percentage'
                ? (preTax * Number(validCoupon.discount_value)) / 100
                : Number(validCoupon.discount_value);
            if (validCoupon.max_discount) {
              discountAmount = Math.min(discountAmount, Number(validCoupon.max_discount));
            }
            discountAmount = Number(Math.min(discountAmount, preTax).toFixed(2));
          }
        }

        const totalFare = Number(Math.max(0, preTax + taxAmount - discountAmount).toFixed(2));

        // Count genuinely available online approved drivers in this category
        const { count: onlineDriversCount } = await admin
          .from('drivers')
          .select('id', { count: 'exact', head: true })
          .eq('category_id', cat.id)
          .eq('approval_status', 'approved')
          .eq('is_verified', true)
          .eq('is_online', true)
          .eq('is_available', true);

        estimates.push({
          categoryId: cat.id,
          slug: cat.slug,
          name: cat.name,
          description: cat.description,
          capacity: cat.capacity,
          baseFare,
          distanceFare,
          timeFare,
          nightFare,
          surgeFare,
          platformFee,
          taxAmount,
          discountAmount,
          totalFare,
          surgeMultiplier: Number(rule.surge_multiplier),
          cancellationFee: Number(rule.cancellation_fee),
          availableDrivers: onlineDriversCount || 0,
          perKmRate: Number(rule.per_km_rate),
          isStandardTariff: false,
        });
      }

      if (estimates.length === 0) {
        return res.json({
          estimates: buildStandardEstimates(distanceMeters, durationSeconds),
          appliedCoupon: null,
          couponError,
          pricingSource: 'standard_tariff',
          notice: 'Showing standard per-km metered fare estimate.',
        });
      }

      return res.json({
        estimates,
        appliedCoupon: validCoupon
          ? { id: validCoupon.id, code: validCoupon.code, title: validCoupon.title }
          : null,
        couponError,
        pricingSource: 'database',
      });
    } catch (err) {
      console.error('Fare estimation error:', err);
      return res.status(500).json({ error: 'Unable to calculate fare estimates from backend rules.' });
    }
  });

  // Create Ride Booking & Match Eligible Drivers
  app.post('/api/rides/book', requireAuth, async (req: AuthedRequest, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId || !req.authUser) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }

    const {
      categoryId,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropAddress,
      dropLat,
      dropLng,
      encodedPolyline,
      distanceMeters,
      durationSeconds,
      paymentMethod = 'upi',
      couponId,
      preferredDriverId,
    } = req.body || {};

    if (
      !categoryId ||
      !pickupAddress ||
      typeof pickupLat !== 'number' ||
      typeof pickupLng !== 'number' ||
      !dropAddress ||
      typeof dropLat !== 'number' ||
      typeof dropLng !== 'number'
    ) {
      return res.status(400).json({ error: 'Complete pickup, drop, and vehicle category are required.' });
    }

    try {
      // Prevent duplicate active bookings for the same customer
      const { data: activeRide } = await admin
        .from('rides')
        .select('id, ride_code, status')
        .eq('customer_id', req.customerId)
        .in('status', [
          'searching_driver',
          'driver_assigned',
          'driver_arriving',
          'driver_reached_pickup',
          'otp_verification',
          'ride_started',
        ])
        .maybeSingle();

      if (activeRide) {
        return res.status(409).json({
          error: `You already have an active ride (${activeRide.ride_code}).`,
          activeRideId: activeRide.id,
        });
      }

      // Recompute authoritative fare on backend (never trust client fare!)
      const { data: fareRule } = await admin
        .from('fare_settings')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!fareRule) {
        return res.status(400).json({ error: 'Pricing rules are not configured for this vehicle category.' });
      }

      const km = Number(distanceMeters || 0) / 1000;
      const mins = Number(durationSeconds || 0) / 60;
      const baseFare = Number(fareRule.base_fare);
      const distanceFare = Number((km * Number(fareRule.per_km_rate)).toFixed(2));
      const timeFare = Number((mins * Number(fareRule.per_minute_rate)).toFixed(2));
      const subtotal = Math.max(Number(fareRule.minimum_fare), baseFare + distanceFare + timeFare);
      const surgeFare = Number((subtotal * (Number(fareRule.surge_multiplier) - 1)).toFixed(2));
      const platformFee = Number(fareRule.platform_fee || 0);
      const taxAmount = Number((((subtotal + surgeFare + platformFee) * Number(fareRule.tax_percentage || 0)) / 100).toFixed(2));

      let discountAmount = 0;
      let verifiedCouponId: string | null = null;
      if (couponId) {
        const { data: coupon } = await admin
          .from('coupons')
          .select('*')
          .eq('id', couponId)
          .eq('is_active', true)
          .maybeSingle();
        if (coupon && new Date(coupon.expires_at) >= new Date()) {
          const preTax = subtotal + surgeFare + platformFee;
          if (preTax >= Number(coupon.min_ride_amount || 0)) {
            discountAmount =
              coupon.discount_type === 'percentage'
                ? (preTax * Number(coupon.discount_value)) / 100
                : Number(coupon.discount_value);
            if (coupon.max_discount) discountAmount = Math.min(discountAmount, Number(coupon.max_discount));
            discountAmount = Number(Math.min(discountAmount, preTax).toFixed(2));
            verifiedCouponId = coupon.id;
          }
        }
      }

      const totalFare = Number(Math.max(0, subtotal + surgeFare + platformFee + taxAmount - discountAmount).toFixed(2));
      const rideOtp = String(crypto.randomInt(1000, 9999));
      const rideCode = `SC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const timeoutSec = Number(fareRule.matching_timeout_sec || 30);
      const matchingExpiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();

      const { data: newRide, error: rideErr } = await admin
        .from('rides')
        .insert({
          ride_code: rideCode,
          customer_id: req.customerId,
          category_id: categoryId,
          status: 'searching_driver',
          pickup_address: pickupAddress,
          pickup_lat: pickupLat,
          pickup_lng: pickupLng,
          drop_address: dropAddress,
          drop_lat: dropLat,
          drop_lng: dropLng,
          encoded_polyline: encodedPolyline || null,
          distance_meters: Math.round(Number(distanceMeters || 0)),
          duration_seconds: Math.round(Number(durationSeconds || 0)),
          base_fare: baseFare,
          distance_fare: distanceFare,
          time_fare: timeFare,
          surge_fare: surgeFare,
          platform_fee: platformFee,
          tax_amount: taxAmount,
          discount_amount: discountAmount,
          total_fare: totalFare,
          coupon_id: verifiedCouponId,
          payment_method: paymentMethod,
          payment_status: paymentMethod === 'cash' ? 'pending_collection' : 'pending',
          ride_otp: rideOtp,
          matching_expires_at: matchingExpiresAt,
        })
        .select('*')
        .single();

      if (rideErr || !newRide) {
        throw rideErr || new Error('Failed to create ride');
      }

      await admin.from('ride_locations').insert([
        { ride_id: newRide.id, location_type: 'pickup', address: pickupAddress, lat: pickupLat, lng: pickupLng },
        { ride_id: newRide.id, location_type: 'drop', address: dropAddress, lat: dropLat, lng: dropLng },
      ]);

      if (verifiedCouponId) {
        await admin.from('coupon_usage').insert({
          coupon_id: verifiedCouponId,
          customer_id: req.customerId,
          ride_id: newRide.id,
          discount_applied: discountAmount,
        });
      }

      // Discover real eligible drivers within configured radius
      const radiusKm = Number(fareRule.search_radius_km || 8);
      const { data: candidates } = await admin
        .from('drivers')
        .select('id, user_id, current_lat, current_lng, vehicles!inner(id, documents_verified, is_active)')
        .eq('category_id', categoryId)
        .eq('approval_status', 'approved')
        .eq('is_verified', true)
        .eq('is_online', true)
        .eq('is_available', true);

      const eligibleDrivers = (candidates || [])
        .filter((d: any) => {
          if (typeof d.current_lat !== 'number' || typeof d.current_lng !== 'number') return false;
          const hasVerifiedVehicle = Array.isArray(d.vehicles)
            ? d.vehicles.some((v: any) => v.is_active && v.documents_verified)
            : false;
          if (!hasVerifiedVehicle) return false;
          return haversineKm(pickupLat, pickupLng, d.current_lat, d.current_lng) <= radiusKm;
        })
        .map((d: any) => ({
          driverId: d.id,
          userId: d.user_id,
          distanceKm: haversineKm(pickupLat, pickupLng, d.current_lat, d.current_lng),
        }))
        .sort((a, b) => {
          if (preferredDriverId) {
            if (a.driverId === preferredDriverId) return -1;
            if (b.driverId === preferredDriverId) return 1;
          }
          return a.distanceKm - b.distanceKm;
        });

      await dispatchNotification({
        admin,
        userId: req.authUser.id,
        type: 'booking_confirmation',
        title: `Ride ${rideCode} Created`,
        body:
          eligibleDrivers.length > 0
            ? `Searching ${eligibleDrivers.length} nearby verified driver(s) for your pickup.`
            : 'Searching for available drivers near your pickup location.',
        deepLink: `/?ride=${newRide.id}`,
        metadata: { rideId: newRide.id, eligibleCount: eligibleDrivers.length },
      });

      // Broadcast to driver dispatch channel (for connected Driver App instances)
      if (eligibleDrivers.length > 0) {
        broadcastChannel(`driver:${eligibleDrivers[0].driverId}`, 'ride:request', {
          rideId: newRide.id,
          rideCode,
          pickupAddress,
          pickupLat,
          pickupLng,
          dropAddress,
          totalFare,
          expiresAt: matchingExpiresAt,
        });
      }

      broadcastChannel(`ride:${newRide.id}`, 'ride:updated', newRide);

      return res.status(201).json({
        ride: newRide,
        eligibleDriversFound: eligibleDrivers.length,
        searchRadiusKm: radiusKm,
        matchingTimeoutSec: timeoutSec,
      });
    } catch (err) {
      console.error('Ride booking error:', err);
      return res.status(500).json({ error: 'Unable to create booking. Please try again.' });
    }
  });

  // Real-time Customer <-> Driver Ride Messages
  app.get('/api/rides/:id/messages', requireAuth, async (req: AuthedRequest, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }
    const { id } = req.params;
    try {
      const { data: ride } = await admin
        .from('rides')
        .select('id, customer_id')
        .eq('id', id)
        .eq('customer_id', req.customerId)
        .maybeSingle();

      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const { data: messages, error: msgErr } = await admin
        .from('ride_messages')
        .select('*')
        .eq('ride_id', id)
        .order('created_at', { ascending: true });

      if (msgErr) throw msgErr;
      return res.json({ messages: messages || [] });
    } catch (err) {
      console.error('Ride messages fetch error:', err);
      return res.status(500).json({ error: 'Unable to load ride messages.' });
    }
  });

  app.post('/api/rides/:id/messages', requireAuth, async (req: AuthedRequest, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId || !req.authUser) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }
    const { id } = req.params;
    const messageText = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!messageText) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    try {
      const { data: ride } = await admin
        .from('rides')
        .select('id, customer_id, driver_id, ride_code, drivers(user_id)')
        .eq('id', id)
        .eq('customer_id', req.customerId)
        .maybeSingle();

      if (!ride) return res.status(404).json({ error: 'Ride not found.' });

      const { data: saved, error: insErr } = await admin
        .from('ride_messages')
        .insert({
          ride_id: id,
          sender_user_id: req.authUser.id,
          sender_role: 'customer',
          message: messageText,
        })
        .select('*')
        .single();

      if (insErr || !saved) throw insErr || new Error('Failed to send message');

      broadcastChannel(`ride:${id}`, 'chat:message', saved);
      const driverObj = Array.isArray((ride as any).drivers)
        ? (ride as any).drivers[0]
        : (ride as any).drivers;
      if (driverObj?.user_id) {
        broadcastChannel(`driver:${ride.driver_id}`, 'chat:message', saved);
      }

      return res.status(201).json({ message: saved });
    } catch (err) {
      console.error('Ride message send error:', err);
      return res.status(500).json({ error: 'Unable to send message.' });
    }
  });

  // Cancel Ride (with backend cancellation fee rule)
  app.post('/api/rides/:id/cancel', requireAuth, async (req: AuthedRequest, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId || !req.authUser) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }

    const { id } = req.params;
    const { reason = 'Cancelled by customer' } = req.body || {};

    try {
      const { data: ride } = await admin
        .from('rides')
        .select('*')
        .eq('id', id)
        .eq('customer_id', req.customerId)
        .single();

      if (!ride) return res.status(404).json({ error: 'Ride not found.' });
      if (['ride_started', 'ride_completed', 'payment_completed', 'cancelled'].includes(ride.status)) {
        return res.status(400).json({ error: `Cannot cancel a ride in "${ride.status}" status.` });
      }

      let cancellationFee = 0;
      if (['driver_arriving', 'driver_reached_pickup', 'otp_verification'].includes(ride.status)) {
        const { data: rule } = await admin
          .from('fare_settings')
          .select('cancellation_fee')
          .eq('category_id', ride.category_id)
          .limit(1)
          .maybeSingle();
        cancellationFee = Number(rule?.cancellation_fee || 0);
      }

      const { data: updated, error: updErr } = await admin
        .from('rides')
        .update({
          status: 'cancelled',
          cancelled_by: 'customer',
          cancellation_reason: reason,
          cancellation_fee: cancellationFee,
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();

      if (updErr) throw updErr;

      if (ride.driver_id) {
        await admin.from('drivers').update({ is_available: true, updated_at: new Date().toISOString() }).eq('id', ride.driver_id);
      }

      await dispatchNotification({
        admin,
        userId: req.authUser.id,
        type: 'ride_cancellation',
        title: `Ride ${ride.ride_code} Cancelled`,
        body: cancellationFee > 0 ? `Cancelled with ₹${cancellationFee} cancellation fee.` : 'Your ride has been cancelled.',
        deepLink: `/rides/${ride.id}`,
      });

      broadcastChannel(`ride:${ride.id}`, 'ride:updated', updated);
      return res.json({ ride: updated });
    } catch (err) {
      console.error('Ride cancellation error:', err);
      return res.status(500).json({ error: 'Failed to cancel ride.' });
    }
  });

  // Create Razorpay Order (or record Cash payment intent)
  app.post('/api/payments/create-order', requireAuth, async (req: AuthedRequest, res: Response) => {
    const cfg = getEnvConfig();
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }

    const { rideId, paymentMethod = 'upi' } = req.body || {};
    if (!rideId) return res.status(400).json({ error: 'rideId is required.' });

    try {
      const { data: ride } = await admin
        .from('rides')
        .select('*')
        .eq('id', rideId)
        .eq('customer_id', req.customerId)
        .single();

      if (!ride) return res.status(404).json({ error: 'Ride not found.' });
      if (ride.payment_status === 'paid') {
        return res.status(409).json({ error: 'This ride has already been paid.' });
      }

      const amount = Number(ride.total_fare || 0);
      const idempotencyKey = `ride_${ride.id}_${paymentMethod}_${Math.round(amount * 100)}`;

      // Check existing idempotent payment
      const { data: existing } = await admin
        .from('payments')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        return res.json({ payment: existing, razorpayKeyId: cfg.razorpayKeyId });
      }

      if (paymentMethod === 'cash') {
        const receiptNumber = `SC-CASH-${Date.now().toString().slice(-6)}`;
        const { data: cashPay, error: cashErr } = await admin
          .from('payments')
          .insert({
            ride_id: ride.id,
            customer_id: req.customerId,
            amount,
            currency: 'INR',
            payment_method: 'cash',
            provider: 'cash',
            idempotency_key: idempotencyKey,
            status: 'pending_collection',
            receipt_number: receiptNumber,
          })
          .select('*')
          .single();
        if (cashErr) throw cashErr;
        await admin.from('payment_events').insert({
          payment_id: cashPay.id,
          event_type: 'cash_selected',
          payload: { amount },
        });
        return res.json({ payment: cashPay });
      }

      if (!cfg.razorpayKeyId || !cfg.razorpayKeySecret) {
        return res.status(503).json({
          error: 'Service configuration required. Please contact support.',
          code: 'RAZORPAY_NOT_CONFIGURED',
        });
      }

      const basicAuth = Buffer.from(`${cfg.razorpayKeyId}:${cfg.razorpayKeySecret}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          amount: Math.max(100, Math.round(amount * 100)),
          currency: 'INR',
          receipt: `rcpt_${ride.ride_code}`,
          notes: { ride_id: ride.id, ride_code: ride.ride_code },
        }),
      });

      const orderData = await rzpRes.json();
      if (!rzpRes.ok || !orderData.id) {
        return res.status(502).json({ error: orderData.error?.description || 'Failed to create Razorpay order.' });
      }

      const receiptNumber = `SC-RZP-${Date.now().toString().slice(-6)}`;
      const { data: payment, error: payErr } = await admin
        .from('payments')
        .insert({
          ride_id: ride.id,
          customer_id: req.customerId,
          amount,
          currency: 'INR',
          payment_method: paymentMethod,
          provider: 'razorpay',
          razorpay_order_id: orderData.id,
          idempotency_key: idempotencyKey,
          status: 'created',
          receipt_number: receiptNumber,
        })
        .select('*')
        .single();

      if (payErr) throw payErr;
      await admin.from('payment_events').insert({
        payment_id: payment.id,
        event_type: 'razorpay_order_created',
        provider_event_id: orderData.id,
        payload: orderData,
      });

      return res.json({ payment, order: orderData, razorpayKeyId: cfg.razorpayKeyId });
    } catch (err) {
      console.error('Payment order error:', err);
      return res.status(500).json({ error: 'Unable to initialize payment.' });
    }
  });

  // Verify Razorpay Payment Signature (never trust frontend success alone)
  app.post('/api/payments/verify', requireAuth, async (req: AuthedRequest, res: Response) => {
    const cfg = getEnvConfig();
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId || !req.authUser) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }
    if (!cfg.razorpayKeySecret) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ error: 'Missing Razorpay verification fields.' });
    }

    const expectedSig = crypto
      .createHmac('sha256', cfg.razorpayKeySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const sigBuf = Buffer.from(String(razorpaySignature), 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(400).json({ error: 'Payment signature verification failed.' });
    }

    try {
      const { data: payment } = await admin
        .from('payments')
        .select('*')
        .eq('razorpay_order_id', razorpayOrderId)
        .eq('customer_id', req.customerId)
        .single();

      if (!payment) return res.status(404).json({ error: 'Payment record not found.' });

      const { data: updatedPayment } = await admin
        .from('payments')
        .update({
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
          status: 'captured',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .select('*')
        .single();

      await admin.from('payment_events').insert({
        payment_id: payment.id,
        event_type: 'signature_verified',
        provider_event_id: razorpayPaymentId,
        payload: { razorpayOrderId, razorpayPaymentId },
      });

      await admin
        .from('rides')
        .update({
          payment_status: 'paid',
          status: 'payment_completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.ride_id);

      await dispatchNotification({
        admin,
        userId: req.authUser.id,
        type: 'payment_confirmation',
        title: 'Payment Confirmed',
        body: `₹${payment.amount} paid successfully. Receipt: ${payment.receipt_number}`,
        deepLink: `/rides/${payment.ride_id}`,
      });

      return res.json({ verified: true, payment: updatedPayment });
    } catch (err) {
      console.error('Payment verify error:', err);
      return res.status(500).json({ error: 'Payment verification failed.' });
    }
  });

  // Request Refund
  app.post('/api/payments/:id/refund', requireAuth, async (req: AuthedRequest, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId || !req.authUser) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }
    const { id } = req.params;
    const { reason = 'Customer requested refund' } = req.body || {};

    try {
      const { data: payment } = await admin
        .from('payments')
        .select('*')
        .eq('id', id)
        .eq('customer_id', req.customerId)
        .single();

      if (!payment) return res.status(404).json({ error: 'Payment not found.' });
      if (payment.status !== 'captured') {
        return res.status(400).json({ error: 'Only captured payments can request a refund.' });
      }

      const { data: updated } = await admin
        .from('payments')
        .update({ status: 'refund_requested', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();

      await admin.from('payment_events').insert({
        payment_id: id,
        event_type: 'refund_requested',
        payload: { reason },
      });

      await dispatchNotification({
        admin,
        userId: req.authUser.id,
        type: 'refund_update',
        title: 'Refund Request Logged',
        body: `Refund request for ₹${payment.amount} (${payment.receipt_number}) is under review.`,
      });

      return res.json({ payment: updated });
    } catch (err) {
      console.error('Refund error:', err);
      return res.status(500).json({ error: 'Failed to submit refund request.' });
    }
  });

  // Trigger SOS Emergency Alert
  app.post('/api/sos/trigger', requireAuth, async (req: AuthedRequest, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin || !req.customerId || !req.authUser) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }

    const { rideId, lat, lng, message = 'Emergency SOS triggered by customer' } = req.body || {};

    try {
      const { data: contacts } = await admin
        .from('emergency_contacts')
        .select('name, phone')
        .eq('customer_id', req.customerId);

      const dispatchedTo = ['SHINE CAB Safety Ops', ...(contacts || []).map((c) => `${c.name} (${c.phone})`)];

      const { data: alert, error: sosErr } = await admin
        .from('sos_alerts')
        .insert({
          ride_id: rideId || null,
          customer_id: req.customerId,
          lat: typeof lat === 'number' ? lat : null,
          lng: typeof lng === 'number' ? lng : null,
          message,
          status: 'dispatched',
          dispatched_to: dispatchedTo,
        })
        .select('*')
        .single();

      if (sosErr || !alert) throw sosErr || new Error('Failed to create SOS alert');

      await dispatchNotification({
        admin,
        userId: req.authUser.id,
        type: 'sos_alert',
        title: 'Emergency SOS Dispatched',
        body: `Alert logged and routed to ${dispatchedTo.join(', ')}.`,
        metadata: { alertId: alert.id, rideId },
      });

      broadcastChannel('safety:ops', 'sos:triggered', alert);

      return res.status(201).json({ alert });
    } catch (err) {
      console.error('SOS trigger error:', err);
      return res.status(500).json({ error: 'Unable to dispatch SOS alert. Please dial local emergency services (112) immediately.' });
    }
  });

  // Public Trip Share Endpoint (scoped strictly by unguessable share_token)
  app.get('/api/trips/share/:token', async (req: Request, res: Response) => {
    const admin = createSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ error: 'Service configuration required. Please contact support.' });
    }

    const { token } = req.params;
    try {
      const { data: ride } = await admin
        .from('rides')
        .select(
          `
          id, ride_code, status, pickup_address, pickup_lat, pickup_lng,
          drop_address, drop_lat, drop_lng, started_at, completed_at,
          vehicle_categories(name, slug),
          drivers(rating_avg, current_lat, current_lng, users(full_name)),
          vehicles(make, model, color, registration_number)
        `
        )
        .eq('share_token', token)
        .maybeSingle();

      if (!ride) return res.status(404).json({ error: 'Shared trip link not found or expired.' });
      return res.json({ trip: ride });
    } catch (err) {
      console.error('Share trip lookup error:', err);
      return res.status(500).json({ error: 'Failed to retrieve shared trip.' });
    }
  });

  // Delete Customer Account
  app.delete('/api/account', requireAuth, async (req: AuthedRequest, res: Response) => {
    const cfg = getEnvConfig();
    if (!cfg.supabaseUrl || !cfg.supabaseServiceKey || !req.authUser) {
      return res.status(503).json({ error: 'Account deletion requires server admin configuration.' });
    }
    const admin = createSupabaseAdmin()!;
    try {
      const { error } = await admin.auth.admin.deleteUser(req.authUser.id);
      if (error) throw error;
      return res.json({ deleted: true });
    } catch (err) {
      console.error('Account delete error:', err);
      return res.status(500).json({ error: 'Unable to delete account right now.' });
    }
  });

  // Shine Support Chatbot (Server-Side @google/genai, fast Flash-Lite + SSE Streaming)
  let cachedGeminiClient: { key: string; ai: GoogleGenAI } | null = null;
  function getGeminiClient(apiKey: string): GoogleGenAI {
    if (cachedGeminiClient && cachedGeminiClient.key === apiKey) {
      return cachedGeminiClient.ai;
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedGeminiClient = { key: apiKey, ai };
    return ai;
  }

  function buildShineSystemInstruction(language?: string): string {
    const langChoice = typeof language === 'string' && language.trim() ? language.trim() : 'auto';
    const languageRule =
      langChoice.toLowerCase() === 'auto'
        ? 'Automatically detect the user’s language or script (including Hindi, Hinglish, English, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu, Assamese, Bhojpuri, Maithili, Konkani, Kashmiri, Manipuri, Nepali, Sindhi, Sanskrit, Dogri, Santali, or any Indian language) and reply fluently in that SAME language and script.'
        : `Reply fluently and naturally in ${langChoice} (using its natural script; if Hinglish is requested, use clear Roman Hindi + English).`;

    return (
      'Your name is Shine, the 24x7 Customer Support Assistant for SHINE CAB (Bike, Auto, and Cab rides in India). ' +
      `${languageRule} ` +
      'Help with: booking Bike/Auto/Cab on Home, Pickup & Drop on map, Nearby Radius Search for verified captains (photo, name, vehicle number, phone, chat), Ride Start 4-digit OTP, UPI/Card/Cash Razorpay payments & refunds in Profile -> Payments, lost items, and 24x7 Emergency SOS (or 112/108/1091). ' +
      'Never invent fake booking IDs or claim refunds were already issued. Keep answers crisp and helpful (under 85 words).'
    );
  }

  function parseSupportChatMessages(rawMessages: unknown) {
    const arr = Array.isArray(rawMessages) ? rawMessages : [];
    return arr
      .filter(
        (m: any) =>
          m &&
          (m.role === 'user' || m.role === 'model') &&
          typeof m.text === 'string' &&
          m.text.trim().length > 0
      )
      .slice(-12)
      .map((m: { role: 'user' | 'model'; text: string }) => ({
        role: m.role,
        parts: [{ text: m.text.trim().slice(0, 1500) }],
      }));
  }

  function mapGeminiError(err: any): { status: number; error: string } {
    const rawStatus = typeof err?.status === 'number' ? err.status : 500;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Shine chatbot error:', rawStatus, msg);
    if (rawStatus === 403 || msg.includes('PERMISSION_DENIED')) {
      return {
        status: 403,
        error: 'Shine chat API key is unauthorized. Please check Settings > Secrets.',
      };
    }
    if (rawStatus === 400 || msg.includes('API_KEY_INVALID')) {
      if (msg.includes('API_KEY_INVALID') || msg.toLowerCase().includes('api key')) {
        return {
          status: 400,
          error: 'Shine chat API key is invalid. Please check Settings > Secrets.',
        };
      }
      return {
        status: 400,
        error: `Unable to process request: ${msg.slice(0, 180)}`,
      };
    }
    if (rawStatus === 404 || msg.includes('NOT_FOUND')) {
      return {
        status: 404,
        error: 'Shine chat model is unavailable right now.',
      };
    }
    if (rawStatus === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
      return {
        status: 429,
        error: 'Shine chat rate limit reached. Please try again in a moment.',
      };
    }
    return {
      status: rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500,
      error: `Shine chat is temporarily unavailable (${rawStatus}).`,
    };
  }

  function isTransientGeminiError(err: any): boolean {
    const rawStatus = typeof err?.status === 'number' ? err.status : 0;
    const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
    return (
      rawStatus === 503 ||
      rawStatus === 500 ||
      rawStatus === 502 ||
      rawStatus === 429 ||
      rawStatus === 404 ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('INTERNAL') ||
      msg.includes('NOT_FOUND') ||
      msg.includes('OVERLOADED')
    );
  }

  const SHINE_CHAT_CANDIDATES: Array<{ model: string; level: ThinkingLevel }> = [
    { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL },
    { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW },
  ];
  const shineModelCooldownUntil = new Map<string, number>();

  function getOrderedShineCandidates() {
    const now = Date.now();
    const healthy = SHINE_CHAT_CANDIDATES.filter(
      (c) => (shineModelCooldownUntil.get(c.model) || 0) <= now
    );
    const cooling = SHINE_CHAT_CANDIDATES.filter(
      (c) => (shineModelCooldownUntil.get(c.model) || 0) > now
    );
    return [...healthy, ...cooling];
  }

  const sleepMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  app.post('/api/support/chat/stream', rateLimit(90, 60_000), async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error:
          'Shine chat requires GEMINI_API_KEY in Settings > Secrets. You can still submit a support ticket or browse FAQs.',
      });
    }

    const cleaned = parseSupportChatMessages(req.body?.messages);
    if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Please enter a valid message to chat.' });
    }

    const systemInstruction = buildShineSystemInstruction(req.body?.language);
    const ai = getGeminiClient(apiKey);
    let lastErr: any = null;
    const baseCandidates = getOrderedShineCandidates();
    const attempts = [...baseCandidates, baseCandidates[baseCandidates.length - 1]];

    for (let idx = 0; idx < attempts.length; idx++) {
      const candidate = attempts[idx];
      if (idx === attempts.length - 1) {
        await sleepMs(250);
      }
      try {
        const stream = await ai.models.generateContentStream({
          model: candidate.model,
          contents: cleaned,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: candidate.level },
          },
        });

        const iterator = stream[Symbol.asyncIterator]();
        const firstStep = await iterator.next();
        if (firstStep.done) {
          throw new Error('Empty stream received from Shine.');
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        let fullText = '';
        const firstPiece = firstStep.value?.text || '';
        if (firstPiece) {
          fullText += firstPiece;
          res.write(`data: ${JSON.stringify({ chunk: firstPiece })}\n\n`);
        }

        while (true) {
          const step = await iterator.next();
          if (step.done) break;
          const piece = step.value?.text || '';
          if (piece) {
            fullText += piece;
            res.write(`data: ${JSON.stringify({ chunk: piece })}\n\n`);
          }
        }

        if (!fullText.trim()) {
          res.write(`data: ${JSON.stringify({ error: 'Empty response received from Shine.' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        }
        return res.end();
      } catch (err: any) {
        lastErr = err;
        if (res.headersSent) {
          const mapped = mapGeminiError(err);
          res.write(`data: ${JSON.stringify({ error: mapped.error })}\n\n`);
          return res.end();
        }
        if (!isTransientGeminiError(err)) {
          break;
        }
        shineModelCooldownUntil.set(candidate.model, Date.now() + 60_000);
      }
    }

    const mapped = mapGeminiError(lastErr);
    return res.status(mapped.status).json({ error: mapped.error });
  });

  app.post('/api/support/chat', rateLimit(90, 60_000), async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error:
          'Shine chat requires GEMINI_API_KEY in Settings > Secrets. You can still submit a support ticket or browse FAQs.',
      });
    }

    const cleaned = parseSupportChatMessages(req.body?.messages);
    if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Please enter a valid message to chat.' });
    }

    const systemInstruction = buildShineSystemInstruction(req.body?.language);
    const ai = getGeminiClient(apiKey);
    let lastErr: any = null;
    const baseCandidates = getOrderedShineCandidates();
    const attempts = [...baseCandidates, baseCandidates[baseCandidates.length - 1]];

    for (let idx = 0; idx < attempts.length; idx++) {
      const candidate = attempts[idx];
      if (idx === attempts.length - 1) {
        await sleepMs(250);
      }
      try {
        const response = await ai.models.generateContent({
          model: candidate.model,
          contents: cleaned,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: candidate.level },
          },
        });

        const reply = (response.text || '').trim();
        if (reply) {
          return res.json({ reply });
        }
        lastErr = new Error('Empty response received from Shine.');
      } catch (err: any) {
        lastErr = err;
        if (!isTransientGeminiError(err)) {
          break;
        }
        shineModelCooldownUntil.set(candidate.model, Date.now() + 60_000);
      }
    }

    const mapped = mapGeminiError(lastErr);
    return res.status(mapped.status).json({ error: mapped.error });
  });

  let cachedGeminiBetaClient: { key: string; ai: GoogleGenAI } | null = null;
  function getGeminiBetaClient(apiKey: string): GoogleGenAI {
    if (cachedGeminiBetaClient && cachedGeminiBetaClient.key === apiKey) {
      return cachedGeminiBetaClient.ai;
    }
    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedGeminiBetaClient = { key: apiKey, ai };
    return ai;
  }

  app.post('/api/support/transcribe', rateLimit(60, 60_000), async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error: 'Voice chat requires GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    const rawAudio = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64.trim() : '';
    const base64Data = rawAudio.includes(',') ? rawAudio.split(',')[1] : rawAudio;
    if (!base64Data || base64Data.length < 32) {
      return res.status(400).json({ error: 'Recorded audio was empty. Please speak and try again.' });
    }

    const rawMime = typeof req.body?.mimeType === 'string' ? req.body.mimeType.split(';')[0].trim().toLowerCase() : 'audio/webm';
    const allowedMimes = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg']);
    const mimeType = allowedMimes.has(rawMime) ? rawMime : 'audio/webm';
    const langHint = typeof req.body?.language === 'string' && req.body.language !== 'auto'
      ? ` The speaker is likely speaking ${req.body.language}.`
      : '';

    const transcribeContents = {
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text:
            `Transcribe the spoken words in this audio accurately in the exact Indian language or English spoken.${langHint} ` +
            'Output ONLY the spoken transcript text with zero extra words or quotes. If there is only silence or no speech, output exactly: [SILENCE]',
        },
      ],
    };

    try {
      const betaAi = getGeminiBetaClient(apiKey);
      let response;
      try {
        response = await betaAi.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: transcribeContents,
        });
      } catch (innerErr: any) {
        if (innerErr?.status === 404 || String(innerErr?.message || '').includes('NOT_FOUND')) {
          const ai = getGeminiClient(apiKey);
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: transcribeContents,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            },
          });
        } else {
          throw innerErr;
        }
      }

      const transcript = (response.text || '').trim();
      if (!transcript || transcript === '[SILENCE]') {
        return res.status(422).json({ error: 'Could not hear clearly. Please speak closer to the mic and try again.' });
      }
      return res.json({ text: transcript });
    } catch (err: any) {
      const mapped = mapGeminiError(err);
      return res.status(mapped.status).json({ error: mapped.error });
    }
  });

  app.post('/api/support/tts', rateLimit(60, 60_000), async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error: 'Voice reply requires GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/[*_`#]/g, '').trim().slice(0, 700) : '';
    if (!text) {
      return res.status(400).json({ error: 'Text is required for voice playback.' });
    }

    try {
      const ai = getGeminiBetaClient(apiKey);
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioBase64) {
        return res.status(502).json({ error: 'Voice playback unavailable for this message.' });
      }
      return res.json({ audioBase64, mimeType: 'audio/wav' });
    } catch (err: any) {
      const mapped = mapGeminiError(err);
      return res.status(mapped.status).json({ error: mapped.error });
    }
  });

  app.get('/api/source-zip', (_req: Request, res: Response) => {
    const zipPath = path.resolve(process.cwd(), 'shine-cab-source.zip');
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'Source archive not found.' });
    }
    return res.download(zipPath, 'shine-cab-source.zip');
  });

  // Vite dev middleware or production static assets
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: { server, path: '/vite-ws' },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SHINE CAB server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SHINE CAB server:', err);
  process.exit(1);
});
