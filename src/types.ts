export type ChargerSummary = {
  total: number;
  available: number;
  charging: number;
  fast: number;
  slow: number;
  stations: string[];
  nearestDistanceMeters: number | null;
  lastUpdated: string | null;
};

export type PlugParkPlace = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  capacity: number | null;
  availableParking: number | null;
  feeText: string;
  operationText: string;
  parkingUpdatedAt: string | null;
  charger: ChargerSummary;
  source: 'live' | 'mock';
};

export type PlacesResponse = {
  ok: boolean;
  generatedAt: string;
  matchRadiusMeters: number;
  parkingCount: number;
  chargerCount: number;
  matchedCount: number;
  places: PlugParkPlace[];
  error?: string;
};
