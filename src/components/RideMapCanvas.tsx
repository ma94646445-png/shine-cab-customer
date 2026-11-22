import React, { useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  Map as GoogleMap,
  MapMouseEvent,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Plus, Minus, MapPin, Gauge, Navigation } from 'lucide-react';
import { LocationPoint, VehicleSlug } from '../types/shinecab';
import { fetchOsrmRoute } from '../lib/osm';

export interface RouteComputedResult {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
  isApproximate?: boolean;
}

export interface NearbyDriverMarker {
  id: string;
  slug: VehicleSlug;
  lat: number;
  lng: number;
  heading?: number;
}

interface RideMapCanvasProps {
  googleMapsApiKey?: string;
  pickup: LocationPoint | null;
  drop: LocationPoint | null;
  driverLocation?: { lat: number; lng: number; heading?: number } | null;
  nearbyDrivers?: NearbyDriverMarker[];
  selectedDriverId?: string | null;
  searchRadiusKm?: number;
  showSearchRadius?: boolean;
  vehicleSlug?: VehicleSlug;
  isActiveRide?: boolean;
  pinSelectMode: 'pickup' | 'drop' | null;
  routeMetrics?: RouteComputedResult | null;
  liveSpeedKmh?: number;
  onSelectNearbyDriver?: (driverId: string) => void;
  onTogglePinSelect?: (mode: 'pickup' | 'drop' | null) => void;
  onPickupClick?: () => void;
  onMapSelectPoint?: (lat: number, lng: number) => void;
  onRequestCurrentGps: () => void;
  onRouteComputed?: (route: RouteComputedResult) => void;
  onRouteError?: (msg: string) => void;
  gpsPermissionDenied?: boolean;
}

const DEFAULT_INDIA_LAT_LNG = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_INDIA_CENTER: [number, number] = [20.5937, 78.9629];

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isQuotaError(err: unknown): boolean {
  const raw = err as { code?: string | number; status?: string | number; message?: string } | null;
  const text = `${raw?.code ?? ''} ${raw?.status ?? ''} ${raw?.message ?? ''} ${String(err ?? '')}`.toUpperCase();
  return (
    text.includes('RESOURCE_EXHAUSTED') ||
    text.includes('OVER_QUERY_LIMIT') ||
    text.includes('QUOTA') ||
    text.includes('429')
  );
}

/** Smoothly interpolates points along a polyline for fluid progressive sweep animations */
function buildDensePath(
  points: google.maps.LatLngLiteral[],
  targetSegments = 120
): google.maps.LatLngLiteral[] {
  if (points.length < 2) return points;
  const segmentLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dLat = points[i + 1].lat - points[i].lat;
    const dLng = points[i + 1].lng - points[i].lng;
    const len = Math.hypot(dLat, dLng);
    segmentLengths.push(len);
    total += len;
  }
  if (total <= 0) return points;

  const dense: google.maps.LatLngLiteral[] = [];
  const step = total / targetSegments;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = segmentLengths[i];
    const count = Math.max(1, Math.round(segLen / step));
    for (let s = 0; s < count; s++) {
      const t = s / count;
      dense.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  dense.push(points[points.length - 1]);
  return dense;
}

/** Custom Google Maps AdvancedMarker visual for Pickup */
const PickupMarkerPin: React.FC<{ address: string; isActiveRide?: boolean; draggable?: boolean }> = ({
  address,
  isActiveRide,
  draggable,
}) => (
  <div
    className={`flex flex-col items-center select-none transition-transform ${
      draggable ? 'cursor-grab active:cursor-grabbing scale-105' : ''
    }`}
    aria-label={`Pickup: ${address}`}
  >
    <div className="mb-1 flex items-center gap-1.5 rounded-xl bg-[#111111] px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_6px_16px_rgba(0,0,0,0.35)] border border-emerald-400/60 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full bg-[#16A34A] shrink-0" />
      <span>Pickup</span>
    </div>
    <div className="relative flex items-center justify-center">
      {isActiveRide && (
        <span className="absolute w-7 h-7 rounded-full bg-[#16A34A]/35 animate-ping" />
      )}
      <div className="w-5 h-5 rounded-full bg-[#16A34A] border-[3px] border-white shadow-[0_3px_10px_rgba(0,0,0,0.4)] flex items-center justify-center">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
      </div>
    </div>
    <div className="w-0.5 h-2 bg-[#111111] rounded-b-full shadow-sm" />
  </div>
);

/** Custom Google Maps AdvancedMarker visual for Drop-off */
const DropoffMarkerPin: React.FC<{ address: string; isActiveRide?: boolean; draggable?: boolean }> = ({
  address,
  isActiveRide,
  draggable,
}) => (
  <div
    className={`flex flex-col items-center select-none transition-transform ${
      draggable ? 'cursor-grab active:cursor-grabbing scale-105' : ''
    }`}
    aria-label={`Drop-off: ${address}`}
  >
    <div className="mb-1 flex items-center gap-1.5 rounded-xl bg-[#111111] px-2.5 py-1 text-[11px] font-bold text-[#F5C518] shadow-[0_6px_16px_rgba(0,0,0,0.35)] border border-[#F5C518]/80 whitespace-nowrap">
      <span className="w-2 h-2 rounded-xs bg-[#F5C518] shrink-0" />
      <span>Drop-off</span>
    </div>
    <div className="relative flex items-center justify-center">
      {isActiveRide && (
        <span className="absolute w-7 h-7 rounded-full bg-[#F5C518]/40 animate-pulse" />
      )}
      <div className="w-5 h-5 rounded-md bg-[#111111] border-[3px] border-[#F5C518] shadow-[0_3px_10px_rgba(0,0,0,0.45)] flex items-center justify-center">
        <span className="w-1.5 h-1.5 rounded-xs bg-[#F5C518]" />
      </div>
    </div>
    <div className="w-0.5 h-2.5 bg-[#111111] rounded-b-full shadow-sm" />
  </div>
);

interface GoogleMapInnerProps {
  pickup: LocationPoint | null;
  drop: LocationPoint | null;
  driverLocation?: { lat: number; lng: number; heading?: number } | null;
  nearbyDrivers: NearbyDriverMarker[];
  selectedDriverId: string | null;
  searchRadiusKm: number;
  showSearchRadius: boolean;
  isActiveRide: boolean;
  pinSelectMode: 'pickup' | 'drop' | null;
  zoomBridgeRef: React.MutableRefObject<((delta: number) => void) | null>;
  onSelectNearbyDriver?: (driverId: string) => void;
  onMapSelectPoint?: (lat: number, lng: number) => void;
  onRouteComputed?: (route: RouteComputedResult) => void;
  onRouteError?: (msg: string) => void;
  onApiStatusFailure: () => void;
}

const GoogleMapInner: React.FC<GoogleMapInnerProps> = ({
  pickup,
  drop,
  driverLocation,
  nearbyDrivers,
  selectedDriverId,
  searchRadiusKm,
  showSearchRadius,
  isActiveRide,
  pinSelectMode,
  zoomBridgeRef,
  onSelectNearbyDriver,
  onMapSelectPoint,
  onRouteComputed,
  onRouteError,
  onApiStatusFailure,
}) => {
  const status = useApiLoadingStatus();
  const map = useMap();
  const routesLib = useMapsLibrary('routes');

  const [routePath, setRoutePath] = useState<google.maps.LatLngLiteral[]>([]);
  const [routeBounds, setRouteBounds] = useState<google.maps.LatLngBoundsLiteral | null>(null);
  const [isApproximateRoute, setIsApproximateRoute] = useState(false);

  const onRouteComputedRef = useRef(onRouteComputed);
  onRouteComputedRef.current = onRouteComputed;
  const onRouteErrorRef = useRef(onRouteError);
  onRouteErrorRef.current = onRouteError;

  const basePolylineRef = useRef<google.maps.Polyline | null>(null);
  const glowPolylineRef = useRef<google.maps.Polyline | null>(null);
  const animatedTracerRef = useRef<google.maps.Polyline | null>(null);
  const driverApproachRef = useRef<google.maps.Polyline | null>(null);
  const radiusCircleRef = useRef<google.maps.Circle | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE || status === APILoadingStatus.FAILED) {
      onApiStatusFailure();
    }
  }, [status, onApiStatusFailure]);

  // Expose imperative zoom controls to right-side buttons
  useEffect(() => {
    zoomBridgeRef.current = (delta: number) => {
      if (!map) return;
      const current = map.getZoom() ?? 14;
      map.setZoom(Math.max(3, Math.min(20, current + delta)));
    };
    return () => {
      zoomBridgeRef.current = null;
    };
  }, [map, zoomBridgeRef]);

  // Auto-center when pickup changes (without drop/driver) or when live driver updates
  useEffect(() => {
    if (!map) return;
    if (driverLocation) {
      map.panTo({ lat: driverLocation.lat, lng: driverLocation.lng });
      return;
    }
    if (pickup && !drop) {
      map.panTo({ lat: pickup.lat, lng: pickup.lng });
      if ((map.getZoom() ?? 5) < 14) {
        map.setZoom(15);
      }
    }
  }, [map, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, driverLocation?.lat, driverLocation?.lng]);

  // Search Radius Circle around Pickup
  useEffect(() => {
    if (radiusCircleRef.current) {
      radiusCircleRef.current.setMap(null);
      radiusCircleRef.current = null;
    }
    if (!map || !showSearchRadius || !pickup || drop || driverLocation) return;

    const circle = new google.maps.Circle({
      map,
      center: { lat: pickup.lat, lng: pickup.lng },
      radius: searchRadiusKm * 1000,
      strokeColor: '#111111',
      strokeOpacity: 0.75,
      strokeWeight: 2,
      fillColor: '#F5C518',
      fillOpacity: 0.16,
    });
    radiusCircleRef.current = circle;

    const bounds = circle.getBounds();
    if (bounds) {
      map.fitBounds(bounds, 36);
    }

    return () => {
      circle.setMap(null);
      if (radiusCircleRef.current === circle) {
        radiusCircleRef.current = null;
      }
    };
  }, [map, showSearchRadius, pickup?.lat, pickup?.lng, searchRadiusKm, drop, driverLocation]);

  // Compute Route via modern Google Maps Platform Routes API (Route.computeRoutes) with safe OSRM fallback
  useEffect(() => {
    if (!pickup || !drop) {
      setRoutePath([]);
      setRouteBounds(null);
      return;
    }

    let cancelled = false;

    const applyFallbackOsrm = async () => {
      try {
        const res = await fetchOsrmRoute(pickup, drop);
        if (cancelled) return;
        const pts: google.maps.LatLngLiteral[] = res.coordinates.map(([lat, lng]) => ({ lat, lng }));
        setRoutePath(pts);
        setIsApproximateRoute(Boolean(res.isApproximate));
        onRouteComputedRef.current?.({
          distanceMeters: res.distanceMeters,
          durationSeconds: res.durationSeconds,
          isApproximate: res.isApproximate,
        });
      } catch {
        if (cancelled) return;
        setRoutePath([
          { lat: pickup.lat, lng: pickup.lng },
          { lat: drop.lat, lng: drop.lng },
        ]);
        setIsApproximateRoute(true);
      }
    };

    if (!routesLib?.Route) {
      applyFallbackOsrm();
      return () => {
        cancelled = true;
      };
    }

    const request: google.maps.routes.ComputeRoutesRequest = {
      origin: { lat: pickup.lat, lng: pickup.lng },
      destination: { lat: drop.lat, lng: drop.lng },
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    routesLib.Route.computeRoutes(request)
      .then((response) => {
        if (cancelled) return;
        const primaryRoute = response?.routes?.[0];
        if (!primaryRoute) {
          applyFallbackOsrm();
          return;
        }

        let extracted: google.maps.LatLngLiteral[] = [];
        if (Array.isArray(primaryRoute.path) && primaryRoute.path.length > 0) {
          extracted = primaryRoute.path.map((pt) => {
            const anyPt = pt as unknown as { lat: number | (() => number); lng: number | (() => number) };
            return {
              lat: typeof anyPt.lat === 'function' ? anyPt.lat() : Number(anyPt.lat),
              lng: typeof anyPt.lng === 'function' ? anyPt.lng() : Number(anyPt.lng),
            };
          });
        } else if (typeof primaryRoute.createPolylines === 'function') {
          const tempLines = primaryRoute.createPolylines();
          tempLines.forEach((line) => {
            const arr = line.getPath().getArray();
            arr.forEach((ll) => extracted.push({ lat: ll.lat(), lng: ll.lng() }));
            line.setMap(null);
          });
        }

        if (extracted.length < 2) {
          applyFallbackOsrm();
          return;
        }

        const distanceMeters = Math.max(100, Math.round(primaryRoute.distanceMeters ?? 0));
        const durationSeconds = Math.max(
          60,
          Math.round((primaryRoute.durationMillis ?? distanceMeters * 130) / 1000)
        );

        setIsApproximateRoute(false);
        setRoutePath(extracted);

        if (primaryRoute.viewport) {
          setRouteBounds(primaryRoute.viewport.toJSON());
        } else {
          setRouteBounds(null);
        }

        onRouteComputedRef.current?.({
          distanceMeters,
          durationSeconds,
          isApproximate: false,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        } else {
          onRouteErrorRef.current?.('Using backup route path calculation.');
        }
        applyFallbackOsrm();
      });

    return () => {
      cancelled = true;
    };
  }, [routesLib, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  // Fit map bounds around the full route + driver
  useEffect(() => {
    if (!map || routePath.length < 2) return;
    if (routeBounds && !driverLocation) {
      map.fitBounds(routeBounds, { top: 56, right: 48, bottom: 48, left: 48 });
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    routePath.forEach((pt) => bounds.extend(pt));
    if (driverLocation) {
      bounds.extend({ lat: driverLocation.lat, lng: driverLocation.lng });
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 56, right: 48, bottom: 48, left: 48 });
    }
  }, [map, routePath, routeBounds, driverLocation?.lat, driverLocation?.lng]);

  // Render Animated Polyline on Google Map for Route & Active Ride Visualization
  useEffect(() => {
    const clearPolylines = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (basePolylineRef.current) {
        basePolylineRef.current.setMap(null);
        basePolylineRef.current = null;
      }
      if (glowPolylineRef.current) {
        glowPolylineRef.current.setMap(null);
        glowPolylineRef.current = null;
      }
      if (animatedTracerRef.current) {
        animatedTracerRef.current.setMap(null);
        animatedTracerRef.current = null;
      }
      if (driverApproachRef.current) {
        driverApproachRef.current.setMap(null);
        driverApproachRef.current = null;
      }
    };

    clearPolylines();

    if (!map || routePath.length < 2) {
      return clearPolylines;
    }

    // 1. Dark Charcoal Outer Base Polyline
    const baseLine = new google.maps.Polyline({
      map,
      path: routePath,
      geodesic: true,
      strokeColor: '#111111',
      strokeOpacity: 0.9,
      strokeWeight: isActiveRide ? 7 : 6,
      zIndex: 10,
    });
    basePolylineRef.current = baseLine;

    // 2. Flowing Directional Arrow Icons along the Polyline
    const arrowSymbol: google.maps.Symbol = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: isActiveRide ? 3.2 : 2.6,
      strokeColor: '#111111',
      strokeWeight: 1.5,
      fillColor: '#F5C518',
      fillOpacity: 1,
    };

    const pulseDotSymbol: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: isActiveRide ? 3.8 : 2.8,
      strokeColor: '#111111',
      strokeWeight: 1.5,
      fillColor: '#FFFFFF',
      fillOpacity: 1,
    };

    const glowLine = new google.maps.Polyline({
      map,
      path: routePath,
      geodesic: true,
      strokeColor: '#F5C518',
      strokeOpacity: isActiveRide ? 0.45 : isApproximateRoute ? 0.55 : 0.92,
      strokeWeight: 3,
      zIndex: 11,
      icons: [
        {
          icon: arrowSymbol,
          offset: '0%',
          repeat: isActiveRide ? '38px' : '56px',
        },
      ],
    });
    glowPolylineRef.current = glowLine;

    // 3. Progressive Gold Tracer Polyline (sweeps from Pickup -> Drop-off for Active Rides)
    const densePath = buildDensePath(routePath, 100);
    const tracerLine = new google.maps.Polyline({
      map,
      path: densePath.slice(0, 2),
      geodesic: true,
      strokeColor: '#F5C518',
      strokeOpacity: 1,
      strokeWeight: isActiveRide ? 4.5 : 3.5,
      zIndex: 12,
      icons: isActiveRide
        ? [
            {
              icon: pulseDotSymbol,
              offset: '100%',
            },
          ]
        : undefined,
    });
    animatedTracerRef.current = tracerLine;

    // 4. Live Driver-to-Pickup dashed green approach line during Active Ride
    if (isActiveRide && driverLocation && pickup) {
      const approachDot: google.maps.Symbol = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 2.5,
        strokeColor: '#16A34A',
        fillColor: '#16A34A',
        fillOpacity: 1,
      };
      driverApproachRef.current = new google.maps.Polyline({
        map,
        path: [
          { lat: driverLocation.lat, lng: driverLocation.lng },
          { lat: pickup.lat, lng: pickup.lng },
        ],
        geodesic: true,
        strokeOpacity: 0,
        zIndex: 13,
        icons: [
          {
            icon: approachDot,
            offset: '0',
            repeat: '12px',
          },
        ],
      });
    }

    let startTs = performance.now();
    let lastUpdateTs = 0;

    const animate = (now: number) => {
      if (now - lastUpdateTs >= 32) {
        lastUpdateTs = now;
        const elapsed = now - startTs;

        // Continuous forward directional symbol flow along the route
        const flowCycleMs = isActiveRide ? 2400 : 3800;
        const flowPercent = ((elapsed % flowCycleMs) / flowCycleMs) * 100;
        const existingIcons = glowLine.get('icons') as google.maps.IconSequence[] | undefined;
        if (existingIcons && existingIcons.length > 0) {
          existingIcons[0].offset = `${flowPercent.toFixed(1)}%`;
          glowLine.set('icons', existingIcons);
        }

        // Progressive sweep segment along dense path (Pickup -> Drop-off)
        const sweepCycleMs = isActiveRide ? 2800 : 4200;
        const progress = (elapsed % sweepCycleMs) / sweepCycleMs;
        const endIdx = Math.max(2, Math.floor(progress * densePath.length));
        const windowSize = isActiveRide
          ? Math.max(12, Math.floor(densePath.length * 0.45))
          : Math.max(10, Math.floor(densePath.length * 0.35));
        const startIdx = Math.max(0, endIdx - windowSize);
        tracerLine.setPath(densePath.slice(startIdx, endIdx));

        if (driverApproachRef.current) {
          const approachIcons = driverApproachRef.current.get('icons') as
            | google.maps.IconSequence[]
            | undefined;
          if (approachIcons && approachIcons.length > 0) {
            approachIcons[0].offset = `${((elapsed % 1200) / 1200) * 100}%`;
            driverApproachRef.current.set('icons', approachIcons);
          }
        }
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return clearPolylines;
  }, [
    map,
    routePath,
    isActiveRide,
    isApproximateRoute,
    driverLocation?.lat,
    driverLocation?.lng,
    pickup?.lat,
    pickup?.lng,
  ]);

  const defaultCenter = pickup
    ? { lat: pickup.lat, lng: pickup.lng }
    : DEFAULT_INDIA_LAT_LNG;

  return (
    <GoogleMap
      mapId="DEMO_MAP_ID"
      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
      defaultCenter={defaultCenter}
      defaultZoom={pickup ? 15 : 5}
      gestureHandling="greedy"
      disableDefaultUI
      className="w-full h-full"
      onClick={(ev: MapMouseEvent) => {
        if (pinSelectMode && ev.detail.latLng && onMapSelectPoint) {
          onMapSelectPoint(ev.detail.latLng.lat, ev.detail.latLng.lng);
        }
      }}
    >
      {/* Custom Pickup AdvancedMarker */}
      {pickup && (
        <AdvancedMarker
          position={{ lat: pickup.lat, lng: pickup.lng }}
          title={`Pickup: ${pickup.address}`}
          draggable={pinSelectMode === 'pickup'}
          zIndex={30}
          onDragEnd={(ev) => {
            const lat = ev.latLng?.lat?.();
            const lng = ev.latLng?.lng?.();
            if (typeof lat === 'number' && typeof lng === 'number') {
              onMapSelectPoint?.(lat, lng);
            }
          }}
        >
          <PickupMarkerPin
            address={pickup.address}
            isActiveRide={isActiveRide}
            draggable={pinSelectMode === 'pickup'}
          />
        </AdvancedMarker>
      )}

      {/* Custom Drop-off AdvancedMarker */}
      {drop && (
        <AdvancedMarker
          position={{ lat: drop.lat, lng: drop.lng }}
          title={`Drop-off: ${drop.address}`}
          draggable={pinSelectMode === 'drop'}
          zIndex={31}
          onDragEnd={(ev) => {
            const lat = ev.latLng?.lat?.();
            const lng = ev.latLng?.lng?.();
            if (typeof lat === 'number' && typeof lng === 'number') {
              onMapSelectPoint?.(lat, lng);
            }
          }}
        >
          <DropoffMarkerPin
            address={drop.address}
            isActiveRide={isActiveRide}
            draggable={pinSelectMode === 'drop'}
          />
        </AdvancedMarker>
      )}

      {/* Nearby Drivers Markers */}
      {!driverLocation &&
        nearbyDrivers.map((d) => {
          const isSelected = d.id === selectedDriverId;
          const emoji = d.slug === 'bike' ? '🏍️' : d.slug === 'auto' ? '🛺' : '🚕';
          return (
            <AdvancedMarker
              key={d.id}
              position={{ lat: d.lat, lng: d.lng }}
              title={`${d.slug.toUpperCase()} Captain`}
              zIndex={isSelected ? 25 : 20}
              anchorLeft="-50%"
              anchorTop="-50%"
              onClick={() => onSelectNearbyDriver?.(d.id)}
            >
              <div
                style={{ transform: `rotate(${d.heading || 0}deg)` }}
                className={`w-8 h-8 rounded-full border-2 border-[#111111] flex items-center justify-center text-base shadow-md cursor-pointer transition-transform ${
                  isSelected ? 'bg-[#F5C518] scale-110' : 'bg-white'
                }`}
              >
                {emoji}
              </div>
            </AdvancedMarker>
          );
        })}

      {/* Live Assigned Active Ride Driver Marker */}
      {driverLocation && (
        <AdvancedMarker
          position={{ lat: driverLocation.lat, lng: driverLocation.lng }}
          title="Live Assigned Driver"
          zIndex={40}
          anchorLeft="-50%"
          anchorTop="-50%"
        >
          <div className="relative flex items-center justify-center">
            <span className="absolute w-11 h-11 rounded-full bg-[#F5C518]/40 animate-ping" />
            <div
              style={{ transform: `rotate(${driverLocation.heading || 0}deg)` }}
              className="w-10 h-10 rounded-full bg-[#F5C518] border-[3px] border-[#111111] flex items-center justify-center text-lg shadow-lg"
            >
              🚕
            </div>
          </div>
        </AdvancedMarker>
      )}
    </GoogleMap>
  );
};

/** Graceful fallback Leaflet map when API key is missing or quota/auth limit is reached */
const LeafletFallbackMap: React.FC<{
  pickup: LocationPoint | null;
  drop: LocationPoint | null;
  driverLocation?: { lat: number; lng: number; heading?: number } | null;
  nearbyDrivers: NearbyDriverMarker[];
  selectedDriverId: string | null;
  searchRadiusKm: number;
  showSearchRadius: boolean;
  isActiveRide: boolean;
  pinSelectMode: 'pickup' | 'drop' | null;
  zoomBridgeRef: React.MutableRefObject<((delta: number) => void) | null>;
  onSelectNearbyDriver?: (driverId: string) => void;
  onMapSelectPoint?: (lat: number, lng: number) => void;
  onRouteComputed?: (route: RouteComputedResult) => void;
}> = ({
  pickup,
  drop,
  driverLocation,
  nearbyDrivers,
  selectedDriverId,
  searchRadiusKm,
  showSearchRadius,
  isActiveRide,
  pinSelectMode,
  zoomBridgeRef,
  onSelectNearbyDriver,
  onMapSelectPoint,
  onRouteComputed,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropMarkerRef = useRef<L.Marker | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const nearbyLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const radiusCircleRef = useRef<L.Circle | null>(null);

  const pinSelectModeRef = useRef(pinSelectMode);
  pinSelectModeRef.current = pinSelectMode;
  const onMapSelectPointRef = useRef(onMapSelectPoint);
  onMapSelectPointRef.current = onMapSelectPoint;
  const onSelectNearbyDriverRef = useRef(onSelectNearbyDriver);
  onSelectNearbyDriverRef.current = onSelectNearbyDriver;
  const onRouteComputedRef = useRef(onRouteComputed);
  onRouteComputedRef.current = onRouteComputed;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = pickup
      ? [pickup.lat, pickup.lng]
      : DEFAULT_INDIA_CENTER;
    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: pickup ? 15 : 5,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    nearbyLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (ev: L.LeafletMouseEvent) => {
      if (pinSelectModeRef.current && onMapSelectPointRef.current) {
        onMapSelectPointRef.current(ev.latlng.lat, ev.latlng.lng);
      }
    });

    mapRef.current = map;
    zoomBridgeRef.current = (delta: number) => {
      map.setZoom(Math.max(3, Math.min(19, map.getZoom() + delta)));
    };

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      zoomBridgeRef.current = null;
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      pickupMarkerRef.current = null;
      dropMarkerRef.current = null;
      driverMarkerRef.current = null;
      nearbyLayerRef.current = null;
      routeLayerRef.current = null;
      radiusCircleRef.current = null;
    };
  }, [zoomBridgeRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (pickupMarkerRef.current) {
      pickupMarkerRef.current.remove();
      pickupMarkerRef.current = null;
    }

    if (pickup) {
      const icon = L.divIcon({
        className: 'shine-pickup-pin',
        html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
          <div style="background:#111111;color:#FFFFFF;font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.3);margin-bottom:4px;white-space:nowrap;">Pickup</div>
          <div style="width:18px;height:18px;border-radius:9999px;background:#16A34A;border:3px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([pickup.lat, pickup.lng], {
        icon,
        draggable: pinSelectMode === 'pickup',
      }).addTo(map);

      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        onMapSelectPointRef.current?.(ll.lat, ll.lng);
      });

      pickupMarkerRef.current = marker;

      if (!drop && !driverLocation) {
        map.setView([pickup.lat, pickup.lng], Math.max(map.getZoom(), 15), { animate: true });
      }
    }
  }, [pickup?.lat, pickup?.lng, pinSelectMode, drop, driverLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (dropMarkerRef.current) {
      dropMarkerRef.current.remove();
      dropMarkerRef.current = null;
    }

    if (drop) {
      const icon = L.divIcon({
        className: 'shine-drop-pin',
        html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
          <div style="background:#111111;color:#F5C518;font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.3);margin-bottom:4px;white-space:nowrap;">Drop-off</div>
          <div style="width:18px;height:18px;border-radius:5px;background:#111111;border:3px solid #F5C518;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const marker = L.marker([drop.lat, drop.lng], {
        icon,
        draggable: pinSelectMode === 'drop',
      }).addTo(map);

      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        onMapSelectPointRef.current?.(ll.lat, ll.lng);
      });

      dropMarkerRef.current = marker;
    }
  }, [drop?.lat, drop?.lng, pinSelectMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (radiusCircleRef.current) {
      radiusCircleRef.current.remove();
      radiusCircleRef.current = null;
    }

    if (showSearchRadius && pickup && !drop && !driverLocation) {
      const circle = L.circle([pickup.lat, pickup.lng], {
        radius: searchRadiusKm * 1000,
        color: '#111111',
        weight: 2,
        opacity: 0.7,
        fillColor: '#F5C518',
        fillOpacity: 0.16,
      }).addTo(map);
      radiusCircleRef.current = circle;
      map.fitBounds(circle.getBounds(), { padding: [36, 36] });
    }
  }, [showSearchRadius, pickup?.lat, pickup?.lng, searchRadiusKm, drop, driverLocation]);

  useEffect(() => {
    const layer = nearbyLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (driverLocation) return;

    for (const d of nearbyDrivers) {
      const isSelected = d.id === selectedDriverId;
      const emoji = d.slug === 'bike' ? '🏍️' : d.slug === 'auto' ? '🛺' : '🚕';
      const bg = isSelected ? '#F5C518' : '#FFFFFF';
      const icon = L.divIcon({
        className: 'shine-nearby-driver',
        html: `<div style="width:34px;height:34px;border-radius:9999px;background:${bg};border:2px solid #111111;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 3px 10px rgba(0,0,0,0.28);transform:translate(-50%,-50%) rotate(${d.heading || 0}deg);" title="${escapeHtml(d.slug)}">${emoji}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const m = L.marker([d.lat, d.lng], { icon });
      m.on('click', () => onSelectNearbyDriverRef.current?.(d.id));
      m.addTo(layer);
    }
  }, [nearbyDrivers, selectedDriverId, driverLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (driverMarkerRef.current) {
      driverMarkerRef.current.remove();
      driverMarkerRef.current = null;
    }

    if (driverLocation) {
      const icon = L.divIcon({
        className: 'shine-active-driver',
        html: `<div style="width:38px;height:38px;border-radius:9999px;background:#F5C518;border:3px solid #111111;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 12px rgba(0,0,0,0.35);transform:translate(-50%,-50%) rotate(${driverLocation.heading || 0}deg);">🚕</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      driverMarkerRef.current = L.marker([driverLocation.lat, driverLocation.lng], { icon }).addTo(map);
      map.panTo([driverLocation.lat, driverLocation.lng], { animate: true });
    }
  }, [driverLocation?.lat, driverLocation?.lng, driverLocation?.heading]);

  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    routeLayer.clearLayers();
    if (!pickup || !drop) return;

    let cancelled = false;
    let timerId: number | null = null;

    fetchOsrmRoute(pickup, drop).then((result) => {
      if (cancelled || !routeLayerRef.current || !mapRef.current) return;
      routeLayerRef.current.clearLayers();

      const outerLine = L.polyline(result.coordinates, {
        color: '#111111',
        weight: 6,
        opacity: 0.9,
      }).addTo(routeLayerRef.current);

      const flowLine = L.polyline(result.coordinates, {
        color: '#F5C518',
        weight: 3,
        opacity: 0.95,
        dashArray: isActiveRide ? '10, 10' : result.isApproximate ? '6, 8' : undefined,
      }).addTo(routeLayerRef.current);

      if (isActiveRide) {
        let offset = 0;
        timerId = window.setInterval(() => {
          offset = (offset - 2) % 20;
          flowLine.setStyle({ dashOffset: String(offset) });
        }, 60);
      }

      const bounds = outerLine.getBounds();
      if (bounds.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [48, 48] });
      }

      onRouteComputedRef.current?.({
        distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds,
        isApproximate: result.isApproximate,
      });
    });

    return () => {
      cancelled = true;
      if (timerId !== null) clearInterval(timerId);
    };
  }, [pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, isActiveRide]);

  return <div ref={containerRef} className="w-full h-full z-0" />;
};

export const RideMapCanvas: React.FC<RideMapCanvasProps> = ({
  googleMapsApiKey,
  pickup,
  drop,
  driverLocation,
  nearbyDrivers = [],
  selectedDriverId = null,
  searchRadiusKm = 5,
  showSearchRadius = false,
  isActiveRide = false,
  pinSelectMode,
  routeMetrics,
  liveSpeedKmh = 0,
  onSelectNearbyDriver,
  onTogglePinSelect,
  onPickupClick,
  onMapSelectPoint,
  onRequestCurrentGps,
  onRouteComputed,
  onRouteError,
  gpsPermissionDenied,
}) => {
  const [fallbackToLeaflet, setFallbackToLeaflet] = useState(false);
  const zoomBridgeRef = useRef<((delta: number) => void) | null>(null);

  useEffect(() => {
    const handleQuota = () => setFallbackToLeaflet(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  const canUseGoogleMaps = Boolean(googleMapsApiKey && !fallbackToLeaflet);

  const handleZoom = (delta: number) => {
    zoomBridgeRef.current?.(delta);
  };

  return (
    <div className="relative w-full h-full min-h-[220px] bg-neutral-200 overflow-hidden">
      {canUseGoogleMaps ? (
        <APIProvider
          apiKey={googleMapsApiKey!}
          region="IN"
          language="en"
          onError={() => setFallbackToLeaflet(true)}
        >
          <GoogleMapInner
            pickup={pickup}
            drop={drop}
            driverLocation={driverLocation}
            nearbyDrivers={nearbyDrivers}
            selectedDriverId={selectedDriverId}
            searchRadiusKm={searchRadiusKm}
            showSearchRadius={showSearchRadius}
            isActiveRide={isActiveRide}
            pinSelectMode={pinSelectMode}
            zoomBridgeRef={zoomBridgeRef}
            onSelectNearbyDriver={onSelectNearbyDriver}
            onMapSelectPoint={onMapSelectPoint}
            onRouteComputed={onRouteComputed}
            onRouteError={onRouteError}
            onApiStatusFailure={() => setFallbackToLeaflet(true)}
          />
        </APIProvider>
      ) : (
        <LeafletFallbackMap
          pickup={pickup}
          drop={drop}
          driverLocation={driverLocation}
          nearbyDrivers={nearbyDrivers}
          selectedDriverId={selectedDriverId}
          searchRadiusKm={searchRadiusKm}
          showSearchRadius={showSearchRadius}
          isActiveRide={isActiveRide}
          pinSelectMode={pinSelectMode}
          zoomBridgeRef={zoomBridgeRef}
          onSelectNearbyDriver={onSelectNearbyDriver}
          onMapSelectPoint={onMapSelectPoint}
          onRouteComputed={onRouteComputed}
        />
      )}

      {/* Right Map Controls (Current GPS, Pin Toggle, Zoom +/-) */}
      <div className="absolute right-3 top-3 z-[400] flex flex-col gap-2">
        <button
          type="button"
          onClick={onRequestCurrentGps}
          aria-label="Center on current GPS location"
          title="Current GPS location"
          className="w-11 h-11 rounded-xl bg-white shadow-md border border-neutral-200 flex items-center justify-center text-[#111111] hover:bg-neutral-50 cursor-pointer"
        >
          <Crosshair className="w-5 h-5" />
        </button>

        {onTogglePinSelect && (
          <button
            type="button"
            onClick={() => onTogglePinSelect(pinSelectMode === 'drop' ? null : 'drop')}
            aria-label="Pin destination on map"
            title="Choose on Map"
            className={`w-11 h-11 rounded-xl shadow-md border flex items-center justify-center cursor-pointer transition ${
              pinSelectMode
                ? 'bg-[#111111] text-[#F5C518] border-[#111111]'
                : 'bg-white text-[#111111] border-neutral-200 hover:bg-neutral-50'
            }`}
          >
            <MapPin className="w-5 h-5" />
          </button>
        )}

        <div className="flex flex-col rounded-xl bg-white shadow-md border border-neutral-200 overflow-hidden">
          <button
            type="button"
            onClick={() => handleZoom(1)}
            aria-label="Zoom in"
            className="w-11 h-11 flex items-center justify-center text-[#111111] hover:bg-neutral-50 border-b border-neutral-100 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(-1)}
            aria-label="Zoom out"
            className="w-11 h-11 flex items-center justify-center text-[#111111] hover:bg-neutral-50 cursor-pointer"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Top-Left Pickup Chip or Active Route Indicator */}
      {!pinSelectMode && onPickupClick && (
        <div className="absolute top-3 left-3 right-16 z-[400] pointer-events-none flex items-start">
          <button
            type="button"
            onClick={onPickupClick}
            className="pointer-events-auto max-w-full min-h-[44px] px-3 py-1.5 rounded-2xl bg-white/95 backdrop-blur-md shadow-md border border-neutral-200 flex items-center gap-2 text-left hover:bg-white cursor-pointer"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A] shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-[#737373] leading-tight">
                {isActiveRide ? 'Live Active Route' : 'Pickup from'}
              </p>
              <p className="text-xs font-semibold text-[#111111] truncate">
                {pickup ? pickup.address : 'Set pickup location'}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Interactive Pin Selection Banner */}
      {pinSelectMode && (
        <div className="pointer-events-none absolute top-3 left-3 right-16 z-[400] flex justify-center">
          <div className="pointer-events-auto bg-[#111111] text-white px-3.5 py-2 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2.5">
            <span>
              Tap map for <strong className="text-[#F5C518]">{pinSelectMode}</strong>
            </span>
            {onTogglePinSelect && (
              <button
                type="button"
                onClick={() => onTogglePinSelect(null)}
                className="text-neutral-300 hover:text-white underline cursor-pointer"
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {/* Live GPS Speedometer Badge (km/h) */}
      <div className="pointer-events-none absolute bottom-6 right-3 z-[400]">
        <div className="bg-[#1E1E1E]/95 text-white border border-white/15 px-3 py-1.5 rounded-xl shadow-lg text-xs font-medium flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-[#F5C518]" />
          <span className="font-mono-num font-bold text-[#F5C518]">{liveSpeedKmh}</span>
          <span className="text-[10px] text-neutral-300">km/h</span>
        </div>
      </div>

      {/* Floating Route Distance & ETA Badge */}
      {pickup && drop && routeMetrics && (
        <div className="pointer-events-none absolute bottom-6 left-3 z-[400]">
          <div className="bg-[#111111]/95 text-white px-3 py-1.5 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2">
            {isActiveRide && <Navigation className="w-3.5 h-3.5 text-[#F5C518] animate-pulse" />}
            <span className="font-mono-num font-bold text-[#F5C518]">
              {(routeMetrics.distanceMeters / 1000).toFixed(1)} km
            </span>
            <span aria-hidden="true" className="text-neutral-500">·</span>
            <span className="font-mono-num font-semibold">
              {Math.max(1, Math.round(routeMetrics.durationSeconds / 60))} min trip
            </span>
          </div>
        </div>
      )}

      {gpsPermissionDenied && !pickup && (
        <div className="absolute bottom-6 left-3 right-24 z-[400] bg-white/95 backdrop-blur-md border border-neutral-200 rounded-xl px-3 py-2 shadow-md text-[11px] text-neutral-700">
          Location permission denied. Search pickup address or tap the map pin button.
        </div>
      )}
    </div>
  );
};
