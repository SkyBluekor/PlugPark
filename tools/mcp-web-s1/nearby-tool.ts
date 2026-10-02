import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { recommendationDistanceMeters } from '../../PlugPark/src/recommendation/recommendPlaces.ts';
import type { PlugParkPlace } from '../../PlugPark/src/types.ts';

const DATA_FILE = resolve(
  process.env.PLUGPARK_DATA_FILE ??
  'data/places.json',
);

type NearbyChargerPreference = 'none' | 'any' | 'fast' | 'slow';

async function loadSnapshotPlaces(): Promise<PlugParkPlace[]> {
  const raw = await readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(raw) as { places?: PlugParkPlace[] };

  if (!Array.isArray(data.places)) {
    throw new Error('places 배열이 없습니다.');
  }

  return data.places;
}

function chargerAvailable(place: PlugParkPlace, preference: NearbyChargerPreference) {
  if (preference === 'none') return true;
  if (preference === 'fast') return (place.charger.availableFast ?? 0) > 0;
  if (preference === 'slow') return (place.charger.availableSlow ?? 0) > 0;
  return (place.charger.available ?? 0) > 0;
}

function summarizePlace(place: PlugParkPlace) {
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    location: {
      lat: place.lat,
      lng: place.lng,
    },
    parking: {
      capacity: place.capacity,
      available: place.availableParking,
      occupied: place.occupiedParking,
      realtime: place.parkingRealtime,
      fresh: place.parkingRealtimeFresh ?? null,
    },
    charging: {
      totalInstalled: place.charger.total,
      totalAvailable: place.charger.available,
      fastInstalled: place.charger.fast,
      fastAvailable: place.charger.availableFast,
      slowInstalled: place.charger.slow,
      slowAvailable: place.charger.availableSlow,
      chargingNow: place.charger.charging,
    },
  };
}

export function registerNearbyPlacesTool(server: McpServer) {
  server.registerTool(
    'nearby_places',
    {
      description:
        '특정 좌표 주변의 PlugPark 장소를 순수 거리 오름차순으로 찾는다. ' +
        '랜드마크/현재 위치 기준으로 가장 가까운 N곳을 찾을 때 사용한다. ' +
        '급속/완속/전체 충전 가능 상태 필터를 적용할 수 있다.',

      inputSchema: z.object({
        userLat: z.number().describe('기준 위치 위도'),
        userLng: z.number().describe('기준 위치 경도'),
        radiusKm: z.number().positive().max(500).describe('검색 반경(km)'),
        chargerPreference: z
          .enum(['none', 'any', 'fast', 'slow'])
          .describe(
            'none=충전 조건 없음, any=충전 가능, fast=급속 사용 가능, slow=완속 사용 가능',
          ),
        limit: z.number().int().min(1).max(10).describe('가까운 순 최대 결과 수'),
      }),

      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },

    async ({
      userLat,
      userLng,
      radiusKm,
      chargerPreference,
      limit,
    }) => {
      const places = await loadSnapshotPlaces();
      const maxMeters = radiusKm * 1000;

      const result = places
        .flatMap((place) => {
          if (
            place.lat == null ||
            place.lng == null ||
            !Number.isFinite(place.lat) ||
            !Number.isFinite(place.lng)
          ) {
            return [];
          }

          if (
            place.parkingRealtime &&
            place.parkingRealtimeFresh === true &&
            place.availableParking === 0
          ) {
            return [];
          }

          if (!chargerAvailable(place, chargerPreference)) {
            return [];
          }

          const distanceMeters = recommendationDistanceMeters(
            userLat,
            userLng,
            place.lat,
            place.lng,
          );

          if (distanceMeters > maxMeters) return [];

          return [{
            place,
            distanceMeters,
          }];
        })
        .sort((a, b) => {
          if (a.distanceMeters !== b.distanceMeters) {
            return a.distanceMeters - b.distanceMeters;
          }
          return a.place.name.localeCompare(b.place.name, 'ko');
        })
        .slice(0, limit)
        .map((item, index) => ({
          rank: index + 1,
          distanceMeters: Math.round(item.distanceMeters),
          place: summarizePlace(item.place),
        }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                radiusKm,
                chargerPreference,
                count: result.length,
                places: result,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
