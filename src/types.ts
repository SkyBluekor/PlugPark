export type ChargerSummary = {
  total: number;
  available: number;
  charging: number;
  fast: number;
  slow: number;
  stations: string[];
  nearestDistanceMeters: number | null;
  lastUpdated: string | null;
  matchConfidence: 'high' | 'medium' | 'low' | null;
};

export type PlugParkPlace = {
  id: string;
  name: string;
  address: string;
  agency: string;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  availableParking: number | null;
  occupiedParking: number | null;
  feeText: string;
  operationText: string;
  parkingUpdatedAt: string | null;
  parkingRealtime: boolean;
  parkingSource: 'busan-city' | 'busan-facilities' | 'merged';
  charger: ChargerSummary;
  source: 'live' | 'mock';
};

export type PlacesResponse = {
  ok: boolean;
  generatedAt: string;
  matchRadiusMeters: number;
  parkingCount: number;
  chargerCount: number;
  chargerStationCount: number;
  matchedCount: number;
  evSnapshotComplete: boolean;
  evSnapshotSource: 'full-cache' | 'busan-live' | 'quick-cache' | 'quick-live';
  realtimeParking: boolean;
  realtimeMessage: string | null;
  places: PlugParkPlace[];
  error?: string;
};
