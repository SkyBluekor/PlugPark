import type { PlugParkPlace } from '../types';

export type RecommendationMode = 'parking' | 'charging';

export type ChargerPreference = 'any' | 'fast' | 'slow';

export type RecommendationOptions = {
  mode: RecommendationMode;
  chargerPreference: ChargerPreference;
  userLat: number;
  userLng: number;
  radiusKm: 1 | 3 | 5 | null;
  limit?: number;
};

export type PlaceRecommendation = {
  place: PlugParkPlace;
  distanceMeters: number;
  rankGroup: number;
  score: number;
  reasons: string[];
  warnings: string[];
};
