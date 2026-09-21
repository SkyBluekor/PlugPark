import { useEffect, useRef, useState } from 'react';
import type { PlugParkPlace } from '../types';

type Props = {
  places: PlugParkPlace[];
  selected: PlugParkPlace | null;
  userLocation: { lat: number; lng: number } | null;
  onSelect: (place: PlugParkPlace) => void;
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
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
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

export default function KakaoMap({ places, selected, userLocation, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const kakaoRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const userOverlayRef = useRef<any>(null);
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
    if (status !== 'ready' || !mapRef.current || !kakaoRef.current) return;
    const kakao = kakaoRef.current;
    const map = mapRef.current;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    if (!places.length) return;
    const bounds = new kakao.maps.LatLngBounds();

    places.slice(0, 150).forEach((place) => {
      const position = new kakao.maps.LatLng(place.lat, place.lng);
      bounds.extend(position);

      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'kakao-place-marker';
      marker.title = place.name;
      marker.setAttribute('aria-label', `${place.name} 선택`);
      marker.innerHTML = `<span>P</span><b>⚡</b>`;
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

    if (!selected) {
      map.setBounds(bounds, 42, 42, 42, 42);
    }

    return () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [places, status, onSelect]);

  useEffect(() => {
    if (!selected || status !== 'ready' || !mapRef.current || !kakaoRef.current) return;
    const position = new kakaoRef.current.maps.LatLng(selected.lat, selected.lng);
    mapRef.current.panTo(position);
    if (mapRef.current.getLevel() > 5) mapRef.current.setLevel(5);
  }, [selected, status]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !kakaoRef.current) return;
    const kakao = kakaoRef.current;
    userOverlayRef.current?.setMap(null);
    userOverlayRef.current = null;
    if (!userLocation) return;

    const node = document.createElement('div');
    node.className = 'kakao-user-marker';
    node.title = '현재 위치';
    userOverlayRef.current = new kakao.maps.CustomOverlay({
      map: mapRef.current,
      position: new kakao.maps.LatLng(userLocation.lat, userLocation.lng),
      content: node,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 5,
    });

    return () => userOverlayRef.current?.setMap(null);
  }, [userLocation, status]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="kakao-map" />
      {status === 'loading' && <div className="map-state">카카오맵 불러오는 중…</div>}
      {status === 'error' && (
        <div className="map-state map-error">
          <strong>지도를 표시할 수 없습니다.</strong>
          <span>{errorText}</span>
          <small>카카오맵 사용 설정과 JavaScript SDK 도메인도 확인하세요.</small>
        </div>
      )}
      {status === 'ready' && <div className="map-caption">P⚡ 주차 + 충전 매칭 장소</div>}
    </div>
  );
}
