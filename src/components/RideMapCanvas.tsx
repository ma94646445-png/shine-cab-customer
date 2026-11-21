import React, { useEffect, useRef, useState } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Crosshair, Plus, Minus, Navigation, MapPin, Bike, Car } from 'lucide-react';
import { LocationPoint, VehicleSlug } from '../types/shinecab';

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
  pickup: LocationPoint | null;
  drop: LocationPoint | null;
  driverLocation?: { lat: number; lng: number; heading?: number } | null;
  nearbyDrivers?: NearbyDriverMarker[];
  selectedDriverId?: string | null;
  searchRadiusKm?: number;
  showSearchRadius?: boolean;
  vehicleSlug?: VehicleSlug;
  pinSelectMode: 'pickup' | 'drop' | null;
  routeMetrics?: RouteComputedResult | null;
  onSelectNearbyDriver?: (driverId: string) => void;
  onTogglePinSelect?: (mode: 'pickup' | 'drop' | null) => void;
  onPickupClick?: () => void;
  onMapSelectPoint?: (lat: number, lng: number) => void;
  onRequestCurrentGps: () => void;
  onRouteComputed?: (route: RouteComputedResult) => void;
  onRouteError?: (msg: string) => void;
  gpsPermissionDenied?: boolean;
}

const DEFAULT_OVERVIEW_CENTER = { lat: 20.5937, lng: 78.9629 };

function computeHaversineMeters(a: LocationPoint, b: LocationPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

function SearchRadiusCircleController({
  center,
  radiusKm,
  visible,
}: {
  center: LocationPoint | null;
  radiusKm: number;
  visible: boolean;
}) {
  const map = useMap();
  const circleRef = useRef<google.maps.Circle | null>(null);

  useEffect(() => {
    if (!map || !visible || !center) {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
      return;
    }

    if (!circleRef.current) {
      circleRef.current = new google.maps.Circle({
        map,
        center: { lat: center.lat, lng: center.lng },
        radius: radiusKm * 1000,
        strokeColor: '#111111',
        strokeOpacity: 0.65,
        strokeWeight: 2,
        fillColor: '#FFC928',
        fillOpacity: 0.16,
        clickable: false,
      });
    } else {
      circleRef.current.setCenter({ lat: center.lat, lng: center.lng });
      circleRef.current.setRadius(radiusKm * 1000);
      circleRef.current.setMap(map);
    }

    const bounds = circleRef.current.getBounds();
    if (bounds) {
      map.fitBounds(bounds, { top: 48, bottom: 48, left: 40, right: 40 });
    }

    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, [map, center?.lat, center?.lng, radiusKm, visible]);

  return null;
}

function RouteOverlayController({
  pickup,
  drop,
  onRouteComputed,
  onRouteError,
}: {
  pickup: LocationPoint | null;
  drop: LocationPoint | null;
  onRouteComputed?: (route: RouteComputedResult) => void;
  onRouteError?: (msg: string) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!map || !pickup || !drop) return;

    let cancelled = false;

    const applyFallbackRoute = () => {
      if (cancelled) return;
      const straightMeters = Math.max(200, computeHaversineMeters(pickup, drop));
      const estimatedSeconds = Math.max(120, Math.round((straightMeters / 1000 / 24) * 3600));

      const line = new google.maps.Polyline({
        path: [
          { lat: pickup.lat, lng: pickup.lng },
          { lat: drop.lat, lng: drop.lng },
        ],
        strokeColor: '#111111',
        strokeOpacity: 0.7,
        strokeWeight: 4,
        map,
      });
      polylinesRef.current = [line];

      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: pickup.lat, lng: pickup.lng });
      bounds.extend({ lat: drop.lat, lng: drop.lng });
      map.fitBounds(bounds, { top: 72, bottom: 72, left: 48, right: 48 });

      onRouteComputed?.({
        distanceMeters: straightMeters,
        durationSeconds: estimatedSeconds,
        isApproximate: true,
      });
    };

    const tryLegacyDirections = () => {
      if (cancelled) return;
      if (typeof google === 'undefined' || !google.maps?.DirectionsService) {
        applyFallbackRoute();
        return;
      }
      const svc = new google.maps.DirectionsService();
      svc.route(
        {
          origin: { lat: pickup.lat, lng: pickup.lng },
          destination: { lat: drop.lat, lng: drop.lng },
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (cancelled) return;
          const route = result?.routes?.[0];
          const leg = route?.legs?.[0];
          if (status === 'OK' && route && leg) {
            const line = new google.maps.Polyline({
              path: route.overview_path || [
                { lat: pickup.lat, lng: pickup.lng },
                { lat: drop.lat, lng: drop.lng },
              ],
              strokeColor: '#111111',
              strokeWeight: 5,
              strokeOpacity: 0.92,
              map,
            });
            polylinesRef.current = [line];
            if (route.bounds) {
              map.fitBounds(route.bounds, { top: 72, bottom: 72, left: 48, right: 48 });
            }
            onRouteComputed?.({
              distanceMeters: Number(leg.distance?.value || 0),
              durationSeconds: Number(leg.duration?.value || 0),
              encodedPolyline: route.overview_polyline,
            });
            return;
          }
          if (status === 'OVER_QUERY_LIMIT') {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          applyFallbackRoute();
        }
      );
    };

    const RouteClass = routesLib?.Route as unknown as
      | {
          computeRoutes?: (req: Record<string, unknown>) => Promise<{ routes: Array<Record<string, unknown>> }>;
        }
      | undefined;

    if (!RouteClass || typeof RouteClass.computeRoutes !== 'function') {
      tryLegacyDirections();
      return () => {
        cancelled = true;
        polylinesRef.current.forEach((p) => p.setMap(null));
        polylinesRef.current = [];
      };
    }

    const request = {
      origin: { lat: pickup.lat, lng: pickup.lng },
      destination: { lat: drop.lat, lng: drop.lng },
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    };

    RouteClass.computeRoutes(request)
      .then((response) => {
        if (cancelled) return;
        const primaryRoute = response.routes?.[0] as
          | {
              distanceMeters?: number;
              durationMillis?: number;
              viewport?: google.maps.LatLngBounds;
              path?: google.maps.LatLng[];
              createPolylines?: () => google.maps.Polyline[];
            }
          | undefined;

        if (!primaryRoute) {
          tryLegacyDirections();
          return;
        }

        if (typeof primaryRoute.createPolylines === 'function') {
          const newLines = primaryRoute.createPolylines();
          newLines.forEach((line) => {
            line.setOptions({
              strokeColor: '#111111',
              strokeWeight: 5,
              strokeOpacity: 0.92,
            });
            line.setMap(map);
          });
          polylinesRef.current = newLines;
        }

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport, { top: 72, bottom: 72, left: 48, right: 48 });
        }

        const distanceMeters = Number(primaryRoute.distanceMeters || 0);
        const durationSeconds = Math.round(Number(primaryRoute.durationMillis || 0) / 1000);
        onRouteComputed?.({ distanceMeters, durationSeconds });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('OVER_QUERY_LIMIT') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        tryLegacyDirections();
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routesLib, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  void onRouteError;
  return null;
}

function MapCameraSync({
  pickup,
  drop,
  driverLocation,
}: {
  pickup: LocationPoint | null;
  drop: LocationPoint | null;
  driverLocation?: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    if (pickup && !drop) {
      map.panTo({ lat: pickup.lat, lng: pickup.lng });
      if ((map.getZoom() || 0) < 14) map.setZoom(15);
    } else if (driverLocation && pickup && !drop) {
      map.panTo({ lat: driverLocation.lat, lng: driverLocation.lng });
    }
  }, [map, pickup?.lat, pickup?.lng, drop, driverLocation?.lat, driverLocation?.lng]);

  return null;
}

function MapCustomControls({
  onRequestCurrentGps,
  pinSelectMode,
  onTogglePinSelect,
}: {
  onRequestCurrentGps: () => void;
  pinSelectMode: 'pickup' | 'drop' | null;
  onTogglePinSelect?: (mode: 'pickup' | 'drop' | null) => void;
}) {
  const map = useMap();

  const handleZoom = (delta: number) => {
    if (!map) return;
    const z = map.getZoom() ?? 13;
    map.setZoom(Math.max(3, Math.min(20, z + delta)));
  };

  return (
    <div className="absolute right-3 top-3 z-20 flex flex-col gap-2">
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
          title="Select drop on map"
          className={`w-11 h-11 rounded-xl shadow-md border flex items-center justify-center cursor-pointer transition ${
            pinSelectMode
              ? 'bg-[#111111] text-[#FFC928] border-[#111111]'
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
  );
}

export const RideMapCanvas: React.FC<RideMapCanvasProps> = ({
  pickup,
  drop,
  driverLocation,
  nearbyDrivers = [],
  selectedDriverId = null,
  searchRadiusKm = 5,
  showSearchRadius = false,
  pinSelectMode,
  routeMetrics,
  onSelectNearbyDriver,
  onTogglePinSelect,
  onPickupClick,
  onMapSelectPoint,
  onRequestCurrentGps,
  onRouteComputed,
  onRouteError,
  gpsPermissionDenied,
}) => {
  const [mapCenter] = useState(
    pickup ? { lat: pickup.lat, lng: pickup.lng } : DEFAULT_OVERVIEW_CENTER
  );

  return (
    <div className="relative w-full h-full min-h-[220px] bg-neutral-200">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={mapCenter}
        defaultZoom={pickup ? 15 : 5}
        gestureHandling="greedy"
        disableDefaultUI
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className="w-full h-full"
        onClick={(ev) => {
          if (pinSelectMode && ev.detail.latLng && onMapSelectPoint) {
            onMapSelectPoint(ev.detail.latLng.lat, ev.detail.latLng.lng);
          }
        }}
      >
        <MapCameraSync pickup={pickup} drop={drop} driverLocation={driverLocation} />
        <SearchRadiusCircleController
          center={pickup}
          radiusKm={searchRadiusKm}
          visible={Boolean(showSearchRadius && !driverLocation && !drop)}
        />
        <RouteOverlayController
          pickup={pickup}
          drop={drop}
          onRouteComputed={onRouteComputed}
          onRouteError={onRouteError}
        />
        <MapCustomControls
          onRequestCurrentGps={onRequestCurrentGps}
          pinSelectMode={pinSelectMode}
          onTogglePinSelect={onTogglePinSelect}
        />

        {pickup && (
          <AdvancedMarker
            position={{ lat: pickup.lat, lng: pickup.lng }}
            draggable={pinSelectMode === 'pickup'}
            onDragEnd={(ev) => {
              if (ev.latLng && onMapSelectPoint) {
                onMapSelectPoint(ev.latLng.lat(), ev.latLng.lng());
              }
            }}
          >
            <div className="flex flex-col items-center">
              <div className="px-2.5 py-1 rounded-lg bg-[#111111] text-white text-[11px] font-semibold shadow-md mb-1 whitespace-nowrap">
                Pickup
              </div>
              <div className="w-5 h-5 rounded-full bg-[#16A34A] border-[3px] border-white shadow-md" />
            </div>
          </AdvancedMarker>
        )}

        {drop && (
          <AdvancedMarker
            position={{ lat: drop.lat, lng: drop.lng }}
            draggable={pinSelectMode === 'drop'}
            onDragEnd={(ev) => {
              if (ev.latLng && onMapSelectPoint) {
                onMapSelectPoint(ev.latLng.lat(), ev.latLng.lng());
              }
            }}
          >
            <div className="flex flex-col items-center">
              <div className="px-2.5 py-1 rounded-lg bg-[#111111] text-[#FFC928] text-[11px] font-semibold shadow-md mb-1 whitespace-nowrap">
                Drop
              </div>
              <div className="w-5 h-5 rounded-md bg-[#111111] border-[3px] border-[#FFC928] shadow-md" />
            </div>
          </AdvancedMarker>
        )}

        {/* Real online approved nearby drivers from Supabase */}
        {!driverLocation &&
          nearbyDrivers.map((d) => {
            const isSelected = d.id === selectedDriverId;
            return (
              <AdvancedMarker
                key={d.id}
                position={{ lat: d.lat, lng: d.lng }}
                onClick={() => onSelectNearbyDriver?.(d.id)}
              >
                <div
                  className={`w-9 h-9 rounded-full border-2 shadow-md flex items-center justify-center transition ${
                    isSelected
                      ? 'bg-[#FFC928] border-[#111111] text-[#111111] scale-110'
                      : 'bg-white border-[#111111] text-[#111111]'
                  }`}
                  style={{ transform: `rotate(${d.heading || 0}deg)` }}
                  title={`Available ${d.slug}`}
                >
                  {d.slug === 'bike' ? <Bike className="w-4 h-4" /> : <Car className="w-4 h-4" />}
                </div>
              </AdvancedMarker>
            );
          })}

        {driverLocation && (
          <AdvancedMarker position={{ lat: driverLocation.lat, lng: driverLocation.lng }}>
            <div
              className="w-10 h-10 rounded-full bg-[#FFC928] border-2 border-[#111111] shadow-lg flex items-center justify-center text-[#111111]"
              style={{ transform: `rotate(${driverLocation.heading || 0}deg)` }}
            >
              <Navigation className="w-5 h-5 fill-current" />
            </div>
          </AdvancedMarker>
        )}
      </GoogleMap>

      {/* Rapido-style Floating Top-Left Pickup Chip */}
      {!pinSelectMode && onPickupClick && (
        <div className="absolute top-3 left-3 right-16 z-20 pointer-events-none flex items-start">
          <button
            type="button"
            onClick={onPickupClick}
            className="pointer-events-auto max-w-full min-h-[44px] px-3 py-1.5 rounded-2xl bg-white/95 backdrop-blur-md shadow-md border border-neutral-200 flex items-center gap-2 text-left hover:bg-white cursor-pointer"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A] shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-[#737373] leading-tight">Pickup from</p>
              <p className="text-xs font-semibold text-[#111111] truncate">
                {pickup ? pickup.address : 'Set pickup location'}
              </p>
            </div>
          </button>
        </div>
      )}

      {pinSelectMode && (
        <div className="pointer-events-none absolute top-3 left-3 right-16 z-20 flex justify-center">
          <div className="pointer-events-auto bg-[#111111] text-white px-3.5 py-2 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2.5">
            <span>
              Tap map for <strong className="text-[#FFC928]">{pinSelectMode}</strong>
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

      {/* Floating Route Distance & ETA indicator when route is active */}
      {pickup && drop && routeMetrics && (
        <div className="pointer-events-none absolute bottom-6 left-3 z-20">
          <div className="bg-[#111111]/95 text-white px-3 py-1.5 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2">
            <span className="font-mono-num font-bold text-[#FFC928]">
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
        <div className="absolute bottom-6 left-3 right-3 z-20 bg-white/95 backdrop-blur-md border border-neutral-200 rounded-xl px-3 py-2 shadow-md text-[11px] text-neutral-700">
          Location permission denied. Search pickup address or tap the map pin button.
        </div>
      )}
    </div>
  );
};

