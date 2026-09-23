import { useEffect, useRef, useState } from 'react';
import type { PlugParkPlace } from '../types';

type Props = {
  places: PlugParkPlace[];
  focusedPlace: PlugParkPlace | null;
  userLocation: { lat: number; lng: number } | null;
  onSelect: (place: PlugParkPlace) => void;
  onLocate: () => void;
};

declare global {
  interface Window {
    kakao?: any;
  }
}

let sdkPromise: Promise<any> | null = null;

function loadKakaoMapSdk(appKey: string) {
  if (window.kakao?.maps) {
    return new Promise<any>((resolve) => window.kakao.maps.load(() => resolve(window.kakao)));
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-plugpark-kakao-map]');
    if (existing) {
      existing.addEventListener('load', () => {
        window.kakao?.maps?.load(() => resolve(window.kakao));
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('Kakao Map SDK 로드 실패')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.dataset.plugparkKakaoMap = 'true';
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
    script.onload = () => {
      if (!window.kakao?.maps) {
        reject(new Error('Kakao Map SDK 객체를 찾을 수 없습니다.'));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao));
    };
    script.onerror = () => reject(new Error('Kakao Map SDK 로드 실패'));
    document.head.appendChild(script);
  });

  return sdkPromise;
}


function hasValidCoordinates(place: PlugParkPlace) {
  return (
    place.lat != null &&
    place.lng != null &&
    place.lat >= 34 &&
    place.lat <= 36 &&
    place.lng >= 128 &&
    place.lng <= 130
  );
}

function geocodePlace(kakao: any, place: PlugParkPlace): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const services = kakao?.maps?.services;
    if (!services) {
      resolve(null);
      return;
    }

    const fallbackKeyword = () => {
      const places = new services.Places();
      const keyword = `부산 ${place.name}`;
      places.keywordSearch(
        keyword,
        (result: any[], status: string) => {
          if (status === services.Status.OK && result?.length) {
            resolve({ lat: Number(result[0].y), lng: Number(result[0].x) });
          } else {
            resolve(null);
          }
        },
        { size: 5 },
      );
    };

    const address =
      place.address && place.address !== '주소 정보 없음'
        ? place.address
        : '';

    if (!address) {
      fallbackKeyword();
      return;
    }

    const geocoder = new services.Geocoder();
    geocoder.addressSearch(address, (result: any[], status: string) => {
      if (status === services.Status.OK && result?.length) {
        resolve({ lat: Number(result[0].y), lng: Number(result[0].x) });
      } else {
        fallbackKeyword();
      }
    });
  });
}

export default function KakaoMap({ places, focusedPlace, userLocation, onSelect, onLocate }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const kakaoRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const userOverlayRef = useRef<any>(null);
  const resolvedPositionsRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const [resolvedVersion, setResolvedVersion] = useState(0);
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

    const unresolved = places
      .filter((place) => !hasValidCoordinates(place) && !resolvedPositionsRef.current.has(place.id))
      .slice(0, 60);

    if (!unresolved.length) return;

    const run = async () => {
      // Kakao local 호출을 한꺼번에 몰아치지 않도록 4개씩 처리합니다.
      for (let i = 0; i < unresolved.length; i += 4) {
        const batch = unresolved.slice(i, i + 4);
        const results = await Promise.all(
          batch.map(async (place) => ({
            id: place.id,
            coords: await geocodePlace(kakao, place),
          })),
        );

        if (cancelled) return;

        let changed = false;
        for (const result of results) {
          if (result.coords) {
            resolvedPositionsRef.current.set(result.id, result.coords);
            changed = true;
          }
        }

        if (changed) setResolvedVersion((version) => version + 1);
        await new Promise((resolve) => window.setTimeout(resolve, 60));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [places, status]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !kakaoRef.current) return;
    const kakao = kakaoRef.current;
    const map = mapRef.current;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    if (!places.length) return;
    const bounds = new kakao.maps.LatLngBounds();

    let markerCount = 0;

    places.slice(0, 150).forEach((place) => {
      const coords = hasValidCoordinates(place)
        ? { lat: place.lat as number, lng: place.lng as number }
        : resolvedPositionsRef.current.get(place.id);

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
    const coords = hasValidCoordinates(focusedPlace)
      ? { lat: focusedPlace.lat as number, lng: focusedPlace.lng as number }
      : resolvedPositionsRef.current.get(focusedPlace.id);
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
          <button className="map-location-button" type="button" onClick={onLocate}>
            ◎ 내 위치
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
