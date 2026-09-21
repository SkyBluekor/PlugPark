import { useEffect, useMemo, useState } from 'react';
import KakaoMap from './components/KakaoMap';
import { mockPlaces } from './mock';
import type { PlacesResponse, PlugParkPlace } from './types';

type ChargerFilter = 'all' | 'parking' | 'available' | 'fast' | 'slow';
type SortKey = 'charger' | 'parking' | 'distance';
type UserLocation = { lat: number; lng: number } | null;

const PAGE_SIZE = 20;

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const p = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(p));
}

function parkingTone(place: PlugParkPlace) {
  if (place.availableParking == null || place.capacity == null || place.capacity <= 0) return 'neutral';
  const ratio = place.availableParking / place.capacity;
  if (ratio >= 0.25) return 'good';
  if (ratio >= 0.1) return 'warn';
  return 'bad';
}

function formatMeters(m: number | null | undefined) {
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function kakaoDirectionsUrl(place: PlugParkPlace) {
  return `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}

function kakaoMapUrl(place: PlugParkPlace) {
  return `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}

export default function App() {
  const [places, setPlaces] = useState<PlugParkPlace[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChargerFilter>('all');
  const [sort, setSort] = useState<SortKey>('charger');
  const [selected, setSelected] = useState<PlugParkPlace | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  async function load() {
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch('/api/places');
      const data = (await response.json()) as PlacesResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `API ${response.status}`);
      }
      setPlaces(data.places);
      setLive(true);
      if (data.places.length === 0) {
        setNotice(`API 연결은 정상이나 ${data.matchRadiusMeters}m 이내에서 주차장·충전소 매칭 결과가 없습니다.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      setPlaces(mockPlaces);
      setLive(false);
      setNotice(`실데이터 연결 실패: ${message} · 예시 데이터로 표시 중`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [query, filter, sort, userLocation]);

  const filteredPlaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = places.filter((p) => {
      if (q && !`${p.name} ${p.address} ${p.charger.stations.join(' ')}`.toLowerCase().includes(q)) return false;
      if (filter === 'parking' && (p.availableParking ?? 0) <= 0) return false;
      if (filter === 'available' && p.charger.available <= 0) return false;
      if (filter === 'fast' && p.charger.fast <= 0) return false;
      if (filter === 'slow' && p.charger.slow <= 0) return false;
      return true;
    });

    result = [...result].sort((a, b) => {
      if (sort === 'distance' && userLocation) {
        return haversineMeters(userLocation.lat, userLocation.lng, a.lat, a.lng)
          - haversineMeters(userLocation.lat, userLocation.lng, b.lat, b.lng);
      }
      if (sort === 'parking') return (b.availableParking ?? -1) - (a.availableParking ?? -1);
      return b.charger.available - a.charger.available;
    });

    return result;
  }, [places, query, filter, sort, userLocation]);

  const displayedPlaces = filteredPlaces.slice(0, displayCount);

  function locate() {
    if (!navigator.geolocation) {
      setNotice('이 브라우저에서는 위치 기능을 사용할 수 없습니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSort('distance');
        setNotice('현재 위치 기준 가까운 순으로 정렬했습니다.');
      },
      () => setNotice('위치 권한을 허용하지 않아 기존 정렬을 유지합니다.'),
      { enableHighAccuracy: false, timeout: 7000 },
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PlugPark 홈">
          <span className="brand-mark">P</span><span>PlugPark</span>
        </a>
        <div className="top-actions">
          <button className="top-location" onClick={locate}>◎ 현재 위치</button>
          <div className={`live-badge ${live ? 'on' : ''}`}><span />{live ? 'LIVE API' : 'DEMO'}</div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">BUSAN EV PARKING + CHARGING</p>
            <h1>주차와 충전을<br/><em>한 번에 찾으세요.</em></h1>
            <p className="hero-desc">부산 공영주차장 실시간 주차면과 EV 충전기 상태를 한 화면에서 확인합니다.</p>
            <a className="primary" href="#finder">지금 찾기</a>
          </div>
          <div className="hero-visual">
            <img src="/plugpark-hero-v2.jpg" alt="부산 도심의 전기차 충전 주차 공간" />
          </div>
        </section>

        <section className="finder" id="finder">
          <div className="finder-toolbar">
            <div>
              <p className="eyebrow">LIVE MATCHING</p>
              <h2>주차 + 충전 가능 장소</h2>
            </div>
            <button className="refresh" onClick={() => void load()} disabled={loading}>{loading ? '불러오는 중…' : '새로고침'}</button>
          </div>

          <div className="search-tools">
            <label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="주차장명·주소 검색" /></label>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬">
              <option value="charger">충전 가능순</option>
              <option value="parking">주차 여유순</option>
              <option value="distance" disabled={!userLocation}>거리순</option>
            </select>
          </div>

          <div className="filters">
            {([['all','전체'],['parking','주차 가능'],['available','충전 가능'],['fast','급속'],['slow','완속']] as const).map(([key,label]) => (
              <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>

          {notice && <div className="notice">{notice}</div>}

          <div className="finder-grid">
            <section className="result-pane" aria-label="검색 결과">
              <div className="result-meta">
                <div><strong>{filteredPlaces.length}</strong>곳</div>
                <span>{displayedPlaces.length}곳 표시</span>
              </div>

              <div className="result-scroll">
                {displayedPlaces.map((place) => {
                  const tone = parkingTone(place);
                  const distance = userLocation ? haversineMeters(userLocation.lat, userLocation.lng, place.lat, place.lng) : null;
                  return (
                    <button className={`place-row ${selected?.id === place.id ? 'selected' : ''}`} key={place.id} onClick={() => setSelected(place)}>
                      <div className="row-head">
                        <div><span className="parking-label">P⚡</span><h3>{place.name}</h3></div>
                        <span className="distance">{distance != null ? formatMeters(distance) : formatMeters(place.charger.nearestDistanceMeters)}</span>
                      </div>
                      <p>{place.address}</p>
                      <div className="row-stats">
                        <span>주차 <b className={tone}>{place.availableParking ?? '—'}</b><small> / {place.capacity ?? '—'}</small></span>
                        <span>충전 <b className={place.charger.available > 0 ? 'good' : 'bad'}>{place.charger.available}</b><small> / {place.charger.total}</small></span>
                        <span><b>{place.charger.fast}</b> 급속 · <b>{place.charger.slow}</b> 완속</span>
                      </div>
                    </button>
                  );
                })}

                {!loading && filteredPlaces.length === 0 && <div className="empty">조건에 맞는 장소가 없습니다.</div>}
                {displayCount < filteredPlaces.length && (
                  <button className="load-more" onClick={() => setDisplayCount((count) => count + PAGE_SIZE)}>
                    {Math.min(PAGE_SIZE, filteredPlaces.length - displayCount)}곳 더 보기
                  </button>
                )}
              </div>
            </section>

            <KakaoMap places={filteredPlaces} selected={selected} userLocation={userLocation} onSelect={setSelected} />
          </div>
        </section>
      </main>

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)} aria-label="상세 닫기">×</button>
            <span className="parking-label">P⚡ MATCHED</span>
            <h2>{selected.name}</h2>
            <p className="detail-address">{selected.address}</p>

            <div className="detail-score">
              <div><span>주차 가능</span><strong>{selected.availableParking ?? '—'} <small>/ {selected.capacity ?? '—'}면</small></strong></div>
              <div><span>EV 충전 가능</span><strong>{selected.charger.available} <small>/ {selected.charger.total}기</small></strong></div>
            </div>

            <dl>
              <div><dt>급속 / 완속</dt><dd>{selected.charger.fast}기 / {selected.charger.slow}기</dd></div>
              <div><dt>가까운 충전기</dt><dd>{formatMeters(selected.charger.nearestDistanceMeters) || '확인 필요'}</dd></div>
              <div><dt>충전소</dt><dd>{selected.charger.stations.join(', ') || '정보 없음'}</dd></div>
              <div><dt>주차요금</dt><dd>{selected.feeText}</dd></div>
              <div><dt>운영시간</dt><dd>{selected.operationText}</dd></div>
            </dl>

            <div className="detail-actions">
              <a className="secondary-action" href={kakaoMapUrl(selected)} target="_blank" rel="noreferrer">카카오맵에서 보기</a>
              <a className="primary" href={kakaoDirectionsUrl(selected)} target="_blank" rel="noreferrer">길찾기</a>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
