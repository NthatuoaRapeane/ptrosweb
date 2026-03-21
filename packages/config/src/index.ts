import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  collection,
  initializeFirestore,
  onSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
const firebaseConfig = {
  apiKey: "AIzaSyBXSeU4cfq171-Mq0GWhxViYl3UUyYwQoE",
  authDomain: "ptros-lesotho-d145d.firebaseapp.com",
  databaseURL: "https://ptros-lesotho-d145d-default-rtdb.firebaseio.com/",
  projectId: "ptros-lesotho-d145d",
  storageBucket: "ptros-lesotho-d145d.firebasestorage.app",
  messagingSenderId: "355339066230",
  appId: "1:355339066230:web:fca735feb941dbd8e57857",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  // Helps on restrictive/proxy networks where streaming transports fail
  // (e.g. intermittent Listen channel / QUIC timeout issues).
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
});
export const storage = getStorage(app);
export const realtimeDb = getDatabase(app);

type RoutePoint = { lat: number; lng: number };
export type LatLngPoint = RoutePoint;

export type RouteNetworkSegmentType =
  | "shortcut"
  | "blocked_path"
  | "restricted_path"
  | string;

export interface RouteNetworkSegment {
  id: string;
  name: string;
  type: RouteNetworkSegmentType;
  status?: string;
  note?: string;
  start: RoutePoint;
  end: RoutePoint;
  blocked?: boolean;
  temporary?: boolean;
  maxWeightKg?: number | null;
  allowedVehicleTypes?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  source?: string;
  createdByName?: string;
  usageCount?: number;
}

export interface RouteNetworkSegmentStyle {
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
  markerColor: string;
  iconMode: "line" | "cross" | "dash" | "dot" | "arrow";
  label: string;
}

const coerceDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;

  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? undefined : fromNumber;
  }

  const maybeTimestamp = value as Timestamp & { toDate?: () => Date };
  if (typeof maybeTimestamp?.toDate === "function") {
    const fromTimestamp = maybeTimestamp.toDate();
    return Number.isNaN(fromTimestamp.getTime()) ? undefined : fromTimestamp;
  }

  if (typeof value === "string") {
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? undefined : fromString;
  }

  return undefined;
};

const coercePoint = (value: any): RoutePoint | null => {
  if (!value) return null;

  const latRaw =
    (typeof value.lat === "function" ? value.lat() : value.lat) ??
    value.latitude ??
    value._lat;
  const lngRaw =
    (typeof value.lng === "function" ? value.lng() : value.lng) ??
    value.lon ??
    value.long ??
    value.longitude ??
    value._long;

  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const normalizeRouteNetworkSegment = (
  id: string,
  value: Record<string, any>,
): RouteNetworkSegment | null => {
  const start = coercePoint(value.start);
  const end = coercePoint(value.end);
  if (!start || !end) return null;

  return {
    id,
    name: value.name || "Unnamed segment",
    type: value.type || "shortcut",
    status: value.status || "active",
    note: value.note,
    start,
    end,
    blocked: !!value.blocked,
    temporary: !!value.temporary,
    maxWeightKg:
      typeof value.maxWeightKg === "number" ? value.maxWeightKg : null,
    allowedVehicleTypes: Array.isArray(value.allowedVehicleTypes)
      ? value.allowedVehicleTypes
      : [],
    createdAt: coerceDate(value.createdAt),
    updatedAt: coerceDate(value.updatedAt),
    source: value.source,
    createdByName: value.createdByName,
    usageCount: Number(value.usageCount || 0),
  };
};

const distanceKm = (a: RoutePoint, b: RoutePoint) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
};

const minDistanceToSegmentKm = (point: RoutePoint, segment: RouteNetworkSegment) => {
  const endpointMin = Math.min(
    distanceKm(point, segment.start),
    distanceKm(point, segment.end),
  );

  const midpoint = {
    lat: (segment.start.lat + segment.end.lat) / 2,
    lng: (segment.start.lng + segment.end.lng) / 2,
  };

  return Math.min(endpointMin, distanceKm(point, midpoint));
};

export const subscribeRouteNetworkSegments = (
  onChange: (segments: RouteNetworkSegment[]) => void,
) =>
  onSnapshot(collection(db, "routeNetworkSegments"), (snapshot) => {
    const segments = snapshot.docs
      .map((docSnap) => normalizeRouteNetworkSegment(docSnap.id, docSnap.data()))
      .filter((segment): segment is RouteNetworkSegment => Boolean(segment))
      .sort(
        (a, b) =>
          (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0),
      );

    onChange(segments);
  });

export const formatRouteNetworkSegmentType = (
  type: RouteNetworkSegmentType,
) =>
  String(type)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const getRouteNetworkSegmentStyle = (
  segment: RouteNetworkSegment,
): RouteNetworkSegmentStyle => {
  const effectiveType = segment.blocked ? "blocked_path" : segment.type;

  switch (effectiveType) {
    case "blocked_path":
      return {
        strokeColor: segment.temporary ? "#f59e0b" : "#dc2626",
        strokeOpacity: 0.95,
        strokeWeight: 6,
        markerColor: segment.temporary ? "#fbbf24" : "#ef4444",
        iconMode: "cross",
        label: segment.temporary ? "Temporary block" : "Blocked path",
      };
    case "restricted_path":
      return {
        strokeColor: "#7c3aed",
        strokeOpacity: 0.92,
        strokeWeight: 5,
        markerColor: "#8b5cf6",
        iconMode: "dash",
        label: "Restricted path",
      };
    case "shortcut":
    default:
      return {
        strokeColor: "#16a34a",
        strokeOpacity: 0.92,
        strokeWeight: 5,
        markerColor: "#22c55e",
        iconMode: "arrow",
        label: "Shortcut",
      };
  }
};

export const getDisplayRouteNetworkSegments = (
  segments: RouteNetworkSegment[],
  referencePoints: Array<RoutePoint | null | undefined>,
  options?: { thresholdKm?: number; fallbackLimit?: number },
) => {
  if (!segments.length) return [];

  const thresholdKm = options?.thresholdKm ?? 10;
  const fallbackLimit = options?.fallbackLimit ?? 80;
  const anchors = referencePoints.filter(
    (point): point is RoutePoint => Boolean(point),
  );

  const activeSegments = segments.filter((segment) => segment.status !== "archived");

  if (!anchors.length) return activeSegments.slice(0, fallbackLimit);

  const scoredSegments = activeSegments.map((segment) => {
    const minDistance = anchors.reduce((best, point) => {
      const pointDistance = minDistanceToSegmentKm(point, segment);
      return pointDistance < best ? pointDistance : best;
    }, Number.POSITIVE_INFINITY);

    return { segment, minDistance };
  });

  const nearbySegments = scoredSegments
    .filter((entry) => entry.minDistance <= thresholdKm)
    .sort(
      (a, b) =>
        a.minDistance - b.minDistance ||
        (b.segment.usageCount || 0) - (a.segment.usageCount || 0),
    )
    .map((entry) => entry.segment);

  if (nearbySegments.length) return nearbySegments;

  return scoredSegments
    .sort(
      (a, b) =>
        a.minDistance - b.minDistance ||
        (b.segment.usageCount || 0) - (a.segment.usageCount || 0),
    )
    .slice(0, fallbackLimit)
    .map((entry) => entry.segment);
};

export default app;
