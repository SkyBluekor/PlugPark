export type ChargerSummary = {
  total: number;
  available: number;
  availableFast: number;
  availableSlow: number;
  charging: number;
  unavailable?: number;
  fast: number;
  slow: number;
  stations: string[];
  nearestDistanceMeters: number | null;
  lastUpdated: string | null;
  statusFresh?: boolean | null;
  matchConfidence: 'high' | 'medium' | 'low' | null;
};

export type RealtimeMatch = {
  matched: boolean;
  type: 'exact-name' | 'contained-name' | 'similar-name' | 'unmatched' | 'ambiguous';
  realtimeName: string | null;
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
  parkingRealtimeFresh?: boolean;
  parkingSource: 'busan-city' | 'busan-facilities' | 'merged';
  realtimeMatch?: RealtimeMatch;
  charger: ChargerSummary;
  source: 'live' | 'mock';
};

export type ParkingMatchSummary = {
  realtimeCount: number;
  matched: number;
  exact: number;
  contained: number;
  similar: number;
  ambiguous: number;
  unmatched: number;
};

export type EvProgress = {
  complete: boolean;
  currentPage: number;
  totalPages: number | null;
  totalCount: number | null;
  collectedChargers: number;
  collectedStations: number;
  nextPage: number;
  lastRawCount: number;
  lastBusanCount: number;
  regionFilterHonored: boolean | null;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
};

export type PlacesResponse = {
  ok: boolean;
  generatedAt: string;
  dataLayerVersion?: string;
  matchRadiusMeters: number;
  parkingCount: number;
  realtimeParkingConfigured: boolean;
  realtimeParkingCount: number;
  realtimeParkingFresh?: boolean;
  realtimeParkingUpdatedAt?: string | null;
  chargerCount: number;
  chargerStationCount: number;
  matchedCount: number;
  evSnapshotComplete: boolean;
  evSnapshotSource: 'd1-read-model' | 'd1-empty';
  evProgress?: null;
  readModelReady?: boolean;
  dataSource?: 'd1-read-model';
  upstreamEvCalls?: number;
  upstreamParkingCalls?: number;
  evStatusFresh?: boolean;
  evStatusUpdatedAt?: string | null;
  evStatusCoverageComplete?: boolean;
  evStatusBaselineAt?: string | null;
  realtimeParking: boolean;
  realtimeMessage: string;
  parkingMatchSummary?: ParkingMatchSummary;
  places: PlugParkPlace[];
  error?: string;
};
