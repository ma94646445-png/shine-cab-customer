import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Plus, Minus, Navigation } from 'lucide-react';
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

const DEFAULT_CENTER: [number, number] = [25.1345, 87.3912];

function computeHaversineMeters(a: LocationPoint, b: LocationPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const createDotIcon = (color: string, label?: string) =>
  L.divIcon({
    className: 'custom-osm-pin',
    html: `<div style="display:flex;flex-direction:column;align-items:center;">${
      label
        ? `<span style="background:#0f172a;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;margin-bottom:2px;white-space:nowrap;">${label}</span>`
        : ''
    }<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div></div>`,
    iconSize: L.point(24, 24),
    iconAnchor: L.point(12, 12),
  });

export const RideMapCanvas: React.FC<RideMapCanvasProps> = ({
  pickup,
  drop,
  driverLocation,
  nearbyDrivers = [],
  selectedDriverId,
  searchRadiusKm = 3,
  showSearchRadius = false,
  pinSelectMode,
  onSelectNearbyDriver,
  onTogglePinSelect,
  onMapSelectPoint,
  onRequestCurrentGps,
  onRouteComputed,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const pinModeRef = useRef(pinSelectMode);
  const onSelectPointRef = useRef(onMapSelectPoint);

  pinModeRef.current = pinSelectMode;
  onSelectPointRef.current = onMapSelectPoint;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: pickup ? [pickup.lat, pickup.lng] : DEFAULT_CENTER,
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layersRef.current = group;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (pinModeRef.current && onSelectPointRef.current) {
        onSelectPointRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    setTimeout(() => map.invalidateSize(), 250);

    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layersRef.current;
    if (!map || !group) return;
    group.clearLayers();

    const pts: L.LatLngExpression[] = [];

    if (pickup) {
      L.marker([pickup.lat, pickup.lng], { icon: createDotIcon('#10b981', 'Pickup') }).addTo(group);
      pts.push([pickup.lat, pickup.lng]);
      if (showSearchRadius) {
        L.circle([pickup.lat, pickup.lng], {
          radius: searchRadiusKm * 1000,
          color: '#f59e0b',
          fillColor: '#fbbf24',
          fillOpacity: 0.12,
          weight: 1.5,
        }).addTo(group);
      }
    }

    if (drop) {
      L.marker([drop.lat, drop.lng], { icon: createDotIcon('#ef4444', 'Drop') }).addTo(group);
      pts.push([drop.lat, drop.lng]);
    }

    if (driverLocation) {
      L.marker([driverLocation.lat, driverLocation.lng], {
        icon: createDotIcon('#f59e0b', 'Captain'),
      }).addTo(group);
      pts.push([driverLocation.lat, driverLocation.lng]);
    }

    nearbyDrivers.forEach((drv) => {
      const m = L.marker([drv.lat, drv.lng], {
        icon: createDotIcon(drv.id === selectedDriverId ? '#2563eb' : '#0f172a'),
      }).addTo(group);
      if (onSelectNearbyDriver) m.on('click', () => onSelectNearbyDriver(drv.id));
    });

    if (pickup && drop) {
      const fallbackDist = computeHaversineMeters(pickup, drop);
      const fallbackDur = Math.max(120, Math.round((fallbackDist / 1000 / 28) * 3600));

      fetch(
        `https://project-osrm.org{pickup.lng},${pickup.lat};${drop.lng},${drop.lat}?overview=full&geometries=geojson`
      )
        .then((r) => r.json())
        .then((data) => {
          const route = data?.routes?.[0];
          if (route?.geometry?.coordinates && layersRef.current) {
            const latlngs = route.geometry.coordinates.map(
              (c: number[]) => [c[1], c[0]] as L.LatLngExpression
            );
            L.polyline(latlngs, { color: '#0f172a', weight: 5, opacity: 0.85 }).addTo(layersRef.current);
            onRouteComputed?.({
              distanceMeters: Math.round(route.distance || fallbackDist),
              durationSeconds: Math.round(route.duration || fallbackDur),
              isApproximate: false,
            });
          } else {
            L.polyline(
              [
                [pickup.lat, pickup.lng],
                [drop.lat, drop.lng],
              ],
              { color: '#0f172a', weight: 4, dashArray: '6, 8' }
            ).addTo(group);
            onRouteComputed?.({
              distanceMeters: Math.round(fallbackDist),
              durationSeconds: fallbackDur,
              isApproximate: true,
            });
          }
        })
        .catch(() => {
          L.polyline(
            [
              [pickup.lat, pickup.lng],
              [drop.lat, drop.lng],
            ],
            { color: '#0f172a', weight: 4, dashArray: '6, 8' }
          ).addTo(group);
          onRouteComputed?.({
            distanceMeters: Math.round(fallbackDist),
            durationSeconds: fallbackDur,
            isApproximate: true,
          });
        });
    }

    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts), { padding: L.point(60, 60), maxZoom: 16 });
    } else if (pts.length === 1) {
      map.setView(pts[0], 15);
    }
  }, [pickup, drop, driverLocation, nearbyDrivers, selectedDriverId, searchRadiusKm, showSearchRadius]);

  return (
    <div className="relative w-full h-full bg-slate-100 overflow-hidden">
      <div ref={containerRef} className="w-full h-full z-0" />
      {pinSelectMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
          <Navigation className="w-3.5 h-3.5 text-amber-400" />
          <span>Tap map to set {pinSelectMode} point</span>
          {onTogglePinSelect && (
            <button onClick={() => onTogglePinSelect(null)} className="ml-1 text-amber-400 underline">
              Done
            </button>
          )}
        </div>
      )}
      <div className="absolute right-3 bottom-44 z-30 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          className="w-10 h-10 bg-white rounded-full shadow-md flex items-center justify-center text-slate-700"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          className="w-10 h-10 bg-white rounded-full shadow-md flex items-center justify-center text-slate-700"
        >
          <Minus className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onRequestCurrentGps}
          className="w-10 h-10 bg-white rounded-full shadow-md flex items-center justify-center text-amber-600"
        >
          <Crosshair className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
