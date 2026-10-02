import { useEffect, useRef, useState } from 'react';
import type { PlugParkPlace } from '../types';
import LocationIcon from './LocationIcon';
import { isBusanCoordinates, kakaoKeywordSearch, loadKakaoMapSdk } from '../services/kakaoSdk';

type Props = {
  places: PlugParkPlace[];
  focusedPlace: PlugParkPlace | null;
  userLocation: { lat: number; lng: number } | null;
  onSelect: (place: PlugParkPlace) => void;
  onLocate: () => void;
  onCoordinateCorrection: (placeId: string, coords: { lat: number; lng: number }) => void;
};

function firstBusanCoordinates(result: any[]) {
  for (const item of result || []) {
    const lat = Number(item?.y);
    const lng = Number(item?.x);
    if (isBusanCoordinates(lat, lng)) return { lat, lng };
  }
  return null;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const radius = 6371000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}


function hasValidCoordinates(place: PlugParkPlace) {
  return (
    place.lat != null &&
    place.lng != null &&
    isBusanCoordinates(place.lat, place.lng)
  );
}

function normalizeLookupText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/부산광역시|부산시/g, '부산')
    .replace(/공영주차장|공영|주차장/g, '')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g, '')
    .trim();
}

function diceSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const pairs = (value: string) => {
    const map = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const pair = value.slice(index, index + 2);
      map.set(pair, (map.get(pair) || 0) + 1);
    }
    return map;
  };

  const left = pairs(a);
  const right = pairs(b);
  let intersection = 0;
  let leftCount = 0;
  let rightCount = 0;
  for (const count of left.values()) leftCount += count;
  for (const count of right.values()) rightCount += count;
  for (const [pair, count] of left) {
    intersection += Math.min(count, right.get(pair) || 0);
  }
  return (2 * intersection) / (leftCount + rightCount);
}

function isSpecificAddress(address: string) {
  const value = String(address || '').trim();
  if (!value || value === '주소 정보 없음') return false;

  // "해운대구" 같은 행정구역명만으로 geocode하면 구청/구 중심점으로 가기 쉽습니다.
  // 도로명/지번 숫자가 있는 주소만 위치 근거로 사용합니다.
  return /\d/.test(value) && /(대로|로|길|동|가|읍|면|리)/.test(value);
}

function candidateScore(place: PlugParkPlace, item: any) {
  const lat = Number(item?.y);
  const lng = Number(item?.x);
  if (!isBusanCoordinates(lat, lng)) return Number.NEGATIVE_INFINITY;

  const targetName = normalizeLookupText(place.name);
  const candidateName = normalizeLookupText(String(item?.place_name || ''));
  if (!targetName || !candidateName) return Number.NEGATIVE_INFINITY;

  let score = diceSimilarity(targetName, candidateName) * 100;

  if (targetName === candidateName) score += 80;
  else if (candidateName.includes(targetName) || targetName.includes(candidateName)) score += 55;

  const candidateAddress = `${String(item?.road_address_name || '')} ${String(item?.address_name || '')}`;
  const sourceAddress = String(place.address || '').trim();
  const sourceAgency = String(place.agency || '').trim();

  if (sourceAddress && sourceAddress !== '주소 정보 없음') {
    const addressTokens = sourceAddress
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !/^부산(?:광역시)?$/.test(token));
    for (const token of addressTokens) {
      if (candidateAddress.includes(token)) score += 6;
    }
  }
  if (sourceAgency && candidateAddress.includes(sourceAgency)) score += 8;

  const category = String(item?.category_name || '');
  if (/주차/.test(category) || /주차/.test(String(item?.place_name || ''))) score += 20;

  return score;
}

function addressSearch(kakao: any, address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const services = kakao?.maps?.services;
    if (!services || !isSpecificAddress(address)) {
      resolve(null);
      return;
    }

    const geocoder = new services.Geocoder();
    geocoder.addressSearch(address, (result: any[], status: string) => {
      if (status !== services.Status.OK || !result?.length) {
        resolve(null);
        return;
      }
      resolve(firstBusanCoordinates(result));
    });
  });
}

async function geocodePlace(
  kakao: any,
  place: PlugParkPlace,
): Promise<{ lat: number; lng: number } | null> {
  const rawName = String(place.name || '').trim();
  const stem = rawName
    .replace(/\s*공영주차장\s*$/u, '')
    .replace(/\s*주차장\s*$/u, '')
    .trim();

  const queries = [
    rawName,
    `부산 ${rawName}`,
    stem ? `${stem} 공영주차장` : '',
    stem ? `부산 ${stem}` : '',
  ].filter(Boolean);

  const seenQueries = [...new Set(queries)];
  const candidates: any[] = [];
  const seenCandidates = new Set<string>();

  for (const query of seenQueries) {
    const results = await kakaoKeywordSearch(kakao, query);
    for (const item of results) {
      const key = `${item?.id || ''}|${item?.x || ''}|${item?.y || ''}|${item?.place_name || ''}`;
      if (seenCandidates.has(key)) continue;
      seenCandidates.add(key);
      candidates.push(item);
    }
  }

  const ranked = candidates
    .map((item) => ({ item, score: candidateScore(place, item) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  // 이름이 충분히 맞는 POI가 있으면 일반 주소보다 그것을 우선합니다.
  // 예: "부산기계공고 공영주차장" ↔ "부산기계공고후문 공영주차장".
  if (ranked[0] && ranked[0].score >= 85) {
    const lat = Number(ranked[0].item.y);
    const lng = Number(ranked[0].item.x);
    return { lat, lng };
  }

  // 이름 검색이 애매할 때만 구체적인 도로명/지번 주소를 fallback으로 사용합니다.
  const byAddress = await addressSearch(kakao, String(place.address || ''));
  if (byAddress) return byAddress;

  return null;
}

export default function KakaoMap({
  places,
  focusedPlace,
  userLocation,
  onSelect,
  onLocate,
  onCoordinateCorrection,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const kakaoRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const userOverlayRef = useRef<any>(null);
  const resolvedPositionsRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const verifiedPositionKeysRef = useRef<Set<string>>(new Set());
  const [resolvedVersion, setResolvedVersion] = useState(0);
  const [renderedMarkerCount, setRenderedMarkerCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');

  const appKey = import.meta.env.VITE_KAKAO_MAP_JS_KEY?.trim();

  useEffect(() => {
    if (!appKey) {
      setStatus('error');
      setErrorText('VITE_KAKAO_MAP_JS_KEY가 없습니다. .env에 JavaScript 키를 입력하세요.');
      return;
    }
    let cancelled = false;

    loadKakaoMapSdk(appKey)
      .then((kakao) => {
        if (cancelled || !containerRef.current) return;
        kakaoRef.current = kakao;
        const center = new kakao.maps.LatLng(35.1796, 129.0756);
        mapRef.current = new kakao.maps.Map(containerRef.current, { center, level: 8 });
        mapRef.current.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorText(error instanceof Error ? error.message : 'Kakao Map을 불러오지 못했습니다.');
      });

    return () => {
      cancelled = true;
    };
  }, [appKey]);

  useEffect(() => {
    if (status !== 'ready' || !kakaoRef.current) return;

    let cancelled = false;
    const kakao = kakaoRef.current;

    // Public parking feeds can contain coordinates that are inside Busan but still
    // point to the wrong facility. Validate visible places against their address.
    const candidates = places
      .filter((place) => {
        const key = `${place.id}|${place.address || ''}`;
        return !verifiedPositionKeysRef.current.has(key);
      })
      .slice(0, 150);

    if (!candidates.length) return;

    const run = async () => {
      // Kakao local calls are throttled in small batches.
      for (let i = 0; i < candidates.length; i += 4) {
        const batch = candidates.slice(i, i + 4);
        const results = await Promise.all(
          batch.map(async (place) => ({
            place,
            coords: await geocodePlace(kakao, place),
          })),
        );

        if (cancelled) return;

        let changed = false;
        for (const { place, coords } of results) {
          const key = `${place.id}|${place.address || ''}`;
          verifiedPositionKeysRef.current.add(key);

          if (!coords) continue;

          const sourceValid = hasValidCoordinates(place);
          const sourceDistance = sourceValid
            ? haversineMeters(place.lat as number, place.lng as number, coords.lat, coords.lng)
            : Number.POSITIVE_INFINITY;

          // Small offsets are normal for large parking lots/buildings. A large
          // disagreement means the address-derived Kakao position is safer.
          if (!sourceValid || sourceDistance > 250) {
            resolvedPositionsRef.current.set(place.id, coords);
            onCoordinateCorrection(place.id, coords);
            changed = true;
          }
        }

        if (changed) setResolvedVersion((version) => version + 1);
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [places, status, onCoordinateCorrection]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !kakaoRef.current) return;
    const kakao = kakaoRef.current;
    const map = mapRef.current;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    if (!places.length) {
      setRenderedMarkerCount(0);
      return;
    }
    const bounds = new kakao.maps.LatLngBounds();

    let markerCount = 0;

    places.slice(0, 150).forEach((place) => {
      const coords =
        resolvedPositionsRef.current.get(place.id) ??
        (hasValidCoordinates(place)
          ? { lat: place.lat as number, lng: place.lng as number }
          : undefined);

      if (!coords) return;

      const position = new kakao.maps.LatLng(coords.lat, coords.lng);
      bounds.extend(position);
      markerCount += 1;

      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = `kakao-place-marker${focusedPlace?.id === place.id ? ' focused' : ''}`;
      marker.title = place.name;
      marker.setAttribute('aria-label', `${place.name} 선택`);
      marker.innerHTML = place.charger.total > 0 ? `<span>P</span><b>⚡</b>` : `<span>P</span>`;
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelect(place);
        map.panTo(position);
      });

      const overlay = new kakao.maps.CustomOverlay({
        map,
        position,
        content: marker,
        xAnchor: 0.5,
        yAnchor: 1.1,
        zIndex: 3,
      });
      overlaysRef.current.push(overlay);
    });

    setRenderedMarkerCount(markerCount);

    if (!focusedPlace && markerCount > 0) {
      map.setBounds(bounds, 42, 42, 42, 42);
    }

    return () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [places, status, onSelect, resolvedVersion, focusedPlace]);

  useEffect(() => {
    if (!focusedPlace || status !== 'ready' || !mapRef.current || !kakaoRef.current) return;
    const coords =
      resolvedPositionsRef.current.get(focusedPlace.id) ??
      (hasValidCoordinates(focusedPlace)
        ? { lat: focusedPlace.lat as number, lng: focusedPlace.lng as number }
        : undefined);
    if (!coords) return;
    const position = new kakaoRef.current.maps.LatLng(coords.lat, coords.lng);
    mapRef.current.panTo(position);
    if (mapRef.current.getLevel() > 5) mapRef.current.setLevel(5);
  }, [focusedPlace, status, resolvedVersion]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !kakaoRef.current) return;
    const kakao = kakaoRef.current;
    userOverlayRef.current?.setMap(null);
    userOverlayRef.current = null;
    if (!userLocation) return;

    const node = document.createElement('div');
    node.className = 'kakao-user-marker';
    node.title = '현재 위치';
    const position = new kakao.maps.LatLng(userLocation.lat, userLocation.lng);
    userOverlayRef.current = new kakao.maps.CustomOverlay({
      map: mapRef.current,
      position,
      content: node,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 5,
    });

    mapRef.current.panTo(position);
    if (mapRef.current.getLevel() > 5) mapRef.current.setLevel(5);

    return () => userOverlayRef.current?.setMap(null);
  }, [userLocation, status]);

  return (
    <div className="map-shell" id="plugpark-map">
      <div ref={containerRef} className="kakao-map" />
      {status === 'loading' && <div className="map-state">카카오맵 불러오는 중…</div>}
      {status === 'error' && (
        <div className="map-state map-error">
          <strong>지도를 표시할 수 없습니다.</strong>
          <span>{errorText}</span>
          <small>카카오맵 사용 설정과 JavaScript SDK 도메인도 확인하세요.</small>
        </div>
      )}
      {status === 'ready' && (
        <>
          {renderedMarkerCount === 0 && (
            <div className="map-state map-empty">
              <strong>표시할 지도 위치가 없습니다.</strong>
              <span>검색 조건이나 반경을 바꿔보세요.</span>
            </div>
          )}
          <button className="map-location-button" type="button" onClick={onLocate} aria-label="내 위치 찾기">
            <LocationIcon className="location-icon" />
            <span>내 위치</span>
          </button>
          <div className="map-caption">
            <span>P</span> 공영주차장
            <span className="caption-separator">·</span>
            <span>P⚡</span> EV 매칭
          </div>
        </>
      )}
    </div>
  );
}
