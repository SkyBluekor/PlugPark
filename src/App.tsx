import { useEffect, useMemo, useState } from 'react';
import KakaoMap from './components/KakaoMap';
import RecommendationPanel from './components/RecommendationPanel';
import { mockPlaces } from './mock';
import { recommendPlaces } from './recommendation/recommendPlaces';
import type { ChargerPreference, RecommendationMode } from './recommendation/recommendationTypes';
import type { PlacesResponse, PlugParkPlace } from './types';

type ChargerFilter = 'all' | 'parking' | 'available' | 'fast' | 'slow';
type SortKey = 'charger' | 'parking' | 'distance';
type UserLocation = { lat: number; lng: number } | null;
type RadiusKm = 1 | 3 | 5 | null;
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
  if (place.lat == null || place.lng == null) {
    return `https://map.kakao.com/?q=${encodeURIComponent(`${place.name} ${place.address}`)}`;
  }
  return `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}

function kakaoMapUrl(place: PlugParkPlace) {
  if (place.lat == null || place.lng == null) {
    return `https://map.kakao.com/?q=${encodeURIComponent(`${place.name} ${place.address}`)}`;
  }
  return `https://map.kakao.com/link/map/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}

async function fetchApiJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const raw = await response.text();
  let data: any;

  try {
    data = JSON.parse(raw);
  } catch {
    const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new Error(
      `API가 JSON 대신 HTML/텍스트를 반환했습니다 (HTTP ${response.status}): ${preview || '빈 응답'}`,
    );
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `API ${response.status}`);
  }

  return data as T;
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
  const [mapFocus, setMapFocus] = useState<PlugParkPlace | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation>(null);
  const [radiusKm, setRadiusKm] = useState<RadiusKm>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [recommendationMode, setRecommendationMode] = useState<RecommendationMode>('charging');
  const [chargerPreference, setChargerPreference] = useState<ChargerPreference>('any');
  const [evStats, setEvStats] = useState({
    parkingCount: 0,
    matchedCount: 0,
    stationCount: 0,
    chargerCount: 0,
    complete: false,
    realtimeParkingConfigured: false,
    realtimeParkingCount: 0,
    realtimeParkingFresh: false,
    evStatusFresh: false,
  });

  async function load() {
    setLoading(true);
    setNotice('공영주차장과 EV 충전정보를 불러오는 중…');

    try {
      const data = await fetchApiJson<PlacesResponse>('/api/places');
      if (!data.ok) throw new Error(data.error || 'PlugPark API 오류');

      setPlaces(data.places);
      setLive(true);
      setEvStats({
        parkingCount: data.parkingCount,
        matchedCount: data.matchedCount,
        stationCount: data.chargerStationCount,
        chargerCount: data.chargerCount,
        complete: data.evSnapshotComplete,
        realtimeParkingConfigured: data.realtimeParkingConfigured ?? false,
        realtimeParkingCount: data.realtimeParkingCount ?? 0,
        realtimeParkingFresh: data.realtimeParkingFresh ?? false,
        evStatusFresh: data.evStatusFresh ?? false,
      });

      if (data.places.length === 0) {
        setNotice('표시할 공영주차장이 없습니다.');
      } else {
        setNotice(data.realtimeMessage || '');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      setPlaces(mockPlaces);
      setLive(false);
      setNotice(`PlugPark 데이터 연결 실패: ${message} · 예시 데이터로 표시 중`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [query, filter, sort, userLocation, radiusKm]);

  const filteredPlaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = places.filter((p) => {
      if (q && !`${p.name} ${p.address} ${p.agency || ''} ${p.charger.stations.join(' ')}`.toLowerCase().includes(q)) return false;
      if (filter === 'parking' && !(p.parkingRealtime && p.availableParking != null)) return false;
      if (filter === 'available' && p.charger.available <= 0) return false;
      if (filter === 'fast' && p.charger.fast <= 0) return false;
      if (filter === 'slow' && p.charger.slow <= 0) return false;
      return true;
    });

    if (userLocation && radiusKm) {
      const maxMeters = radiusKm * 1000;
      result = result.filter((place) => {
        if (place.lat == null || place.lng == null) return false;
        return haversineMeters(userLocation.lat, userLocation.lng, place.lat, place.lng) <= maxMeters;
      });
    }

    result = [...result].sort((a, b) => {
      if (sort === 'distance' && userLocation) {
        const aDistance =
          a.lat != null && a.lng != null
            ? haversineMeters(userLocation.lat, userLocation.lng, a.lat, a.lng)
            : Number.POSITIVE_INFINITY;
        const bDistance =
          b.lat != null && b.lng != null
            ? haversineMeters(userLocation.lat, userLocation.lng, b.lat, b.lng)
            : Number.POSITIVE_INFINITY;
        return aDistance - bDistance;
      }
      if (sort === 'parking') return (b.availableParking ?? -1) - (a.availableParking ?? -1);
      return b.charger.available - a.charger.available;
    });

    return result;
  }, [places, query, filter, sort, userLocation, radiusKm]);

  const recommendations = useMemo(() => {
    if (!userLocation) return [];
    return recommendPlaces(places, {
      mode: recommendationMode,
      chargerPreference,
      userLat: userLocation.lat,
      userLng: userLocation.lng,
      radiusKm,
      limit: 3,
    });
  }, [places, userLocation, radiusKm, recommendationMode, chargerPreference]);

  const mapPlaces = useMemo(() => {
    if (!mapFocus || filteredPlaces.some((place) => place.id === mapFocus.id)) {
      return filteredPlaces;
    }
    return [mapFocus, ...filteredPlaces];
  }, [filteredPlaces, mapFocus]);

  const displayedPlaces = filteredPlaces.slice(0, displayCount);

  function openPlaceDetail(place: PlugParkPlace) {
    setSelected(place);
    setMapFocus(place);
  }

  function focusPlaceOnMap(place: PlugParkPlace) {
    setMapFocus(place);
    setSelected(null);
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      document.getElementById('plugpark-map')?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }

  function typedAvailabilityText(place: PlugParkPlace, type: 'fast' | 'slow') {
    const installed = type === 'fast' ? place.charger.fast : place.charger.slow;
    const available = type === 'fast' ? place.charger.availableFast : place.charger.availableSlow;
    const label = type === 'fast' ? '급속' : '완속';

    if (installed <= 0) return `${label} 없음`;
    if (place.charger.statusFresh === true) {
      return `${label} ${available}기 가능 / ${installed}기`;
    }
    if (place.charger.statusFresh === false) {
      return `${label} ${installed}기 설치 · 상태 갱신 지연`;
    }
    return `${label} ${installed}기 설치`;
  }

  function locate() {
    if (!navigator.geolocation) {
      setNotice('이 브라우저에서는 위치 기능을 사용할 수 없습니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setRadiusKm(3);
        setSort('distance');
        setSelected(null);
        setMapFocus(null);
        setNotice('현재 위치 기준 3km 이내 장소를 가까운 순으로 표시합니다.');
      },
      (error) => {
        const message =
          error.code === 1
            ? '위치 권한이 차단되었습니다. 브라우저 사이트 설정에서 위치 권한을 허용해주세요.'
            : '현재 위치를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.';
        setNotice(message);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PlugPark 홈">
          <span className="brand-mark">P</span><span>PlugPark</span>
        </a>
        <div className="top-actions">
          <button className={`top-location ${userLocation ? 'active' : ''}`} onClick={locate}>◎ {userLocation ? '내 위치 사용 중' : '내 위치'}</button>
          <div className={`live-badge ${live ? 'on' : ''}`}><span />{live ? 'LIVE DATA' : 'DEMO'}</div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">BUSAN EV PARKING + CHARGING</p>
            <h1>주차와 충전을<br/><em>한 번에 찾으세요.</em></h1>
            <p className="hero-desc">부산 공영주차장과 EV 충전기 정보를 한 화면에서 확인합니다.</p>
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
              <h2>부산 공영주차장 찾기</h2>
            </div>
            <button className="refresh" onClick={() => void load()} disabled={loading}>{loading ? '불러오는 중…' : '새로고침'}</button>
          </div>

          {evStats.parkingCount > 0 && (
            <div className="dataset-summary">
              <span>공영주차장 <b>{evStats.parkingCount.toLocaleString()}곳</b></span>
              <span>
                실시간 잔여 제공{' '}
                <b>
                  {evStats.realtimeParkingConfigured
                    ? `${evStats.realtimeParkingCount.toLocaleString()}곳${evStats.realtimeParkingFresh ? '' : ' · 갱신지연'}`
                    : '연동 전'}
                </b>
              </span>
              <span>EV 충전 가능 공영주차장 <b>{`${evStats.matchedCount.toLocaleString()}곳`}</b></span>
              <span>부산 EV 충전소 <b>{`${evStats.stationCount.toLocaleString()}곳`}</b></span>
              <span>충전기 <b>{`${evStats.chargerCount.toLocaleString()}기`}</b></span>
              <em>{live ? 'D1 데이터' : '예시 데이터'}</em>
            </div>
          )}

          <div className="search-tools">
            <label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="주차장명·주소 검색" /></label>
            <button className={`location-button ${userLocation ? 'active' : ''}`} onClick={locate}>
              <span>◎</span>{userLocation ? '내 위치 다시 찾기' : '내 위치 기준'}
            </button>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬">
              <option value="charger">충전 가능순</option>
              <option value="parking">주차 여유순</option>
              <option value="distance" disabled={!userLocation}>거리순</option>
            </select>
          </div>

          <div className="filters">
            {([['all','전체'],['parking','실시간 잔여'],['available','충전 가능'],['fast','급속'],['slow','완속']] as const).map(([key,label]) => (
              <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>

          {userLocation && (
            <div className="nearby-tools">
              <span className="nearby-title">내 주변</span>
              {([1, 3, 5] as const).map((km) => (
                <button
                  key={km}
                  className={radiusKm === km ? 'active' : ''}
                  onClick={() => {
                    setRadiusKm(km);
                    setSort('distance');
                    setSelected(null);
                    setMapFocus(null);
                  }}
                >
                  {km}km
                </button>
              ))}
              <button
                className={radiusKm === null ? 'active' : ''}
                onClick={() => setRadiusKm(null)}
              >
                전체
              </button>
              <button
                className="clear-location"
                onClick={() => {
                  setUserLocation(null);
                  setRadiusKm(null);
                  setSelected(null);
                  setMapFocus(null);
                  if (sort === 'distance') setSort('charger');
                  setNotice('');
                }}
              >
                위치 해제
              </button>
            </div>
          )}



          {notice && <div className="notice">{notice}</div>}

          <RecommendationPanel
            recommendations={recommendations}
            mode={recommendationMode}
            chargerPreference={chargerPreference}
            hasLocation={Boolean(userLocation)}
            onModeChange={setRecommendationMode}
            onChargerPreferenceChange={setChargerPreference}
            onLocate={locate}
            onFocusMap={focusPlaceOnMap}
            onOpenDetail={openPlaceDetail}
            getDirectionsUrl={kakaoDirectionsUrl}
          />

          <div className="finder-grid">
            <section className="result-pane" aria-label="검색 결과">
              <div className="result-meta">
                <div><strong>{filteredPlaces.length}</strong>곳</div>
                <span>{displayedPlaces.length}곳 표시</span>
              </div>

              <div className="result-scroll">
                {displayedPlaces.map((place) => {
                  const tone = parkingTone(place);
                  const distance =
                    userLocation && place.lat != null && place.lng != null
                      ? haversineMeters(userLocation.lat, userLocation.lng, place.lat, place.lng)
                      : null;
                  return (
                    <button className={`place-row ${selected?.id === place.id ? 'selected' : ''}`} key={place.id} onClick={() => openPlaceDetail(place)}>
                      <div className="row-head">
                        <div><span className="parking-label">{place.charger.total > 0 ? 'P⚡' : 'P'}</span><h3>{place.name}</h3></div>
                        <span className="distance">{distance != null ? formatMeters(distance) : formatMeters(place.charger.nearestDistanceMeters)}</span>
                      </div>
                      <p>
                        {place.address && place.address !== '주소 정보 없음'
                          ? place.address
                          : (place.agency || '주소 위치 확인 중')}
                      </p>
                      <div className="row-stats">
                        {place.availableParking != null ? (
                          <span>
                            주차 가능 <b className={tone}>{place.availableParking}</b>
                            <small>{place.capacity && place.capacity > 0 ? ` / 총 ${place.capacity}면` : '면'}</small>
                            {place.parkingRealtime && <small className="realtime-mini"> · 실시간</small>}
                          </span>
                        ) : place.capacity != null && place.capacity > 0 ? (
                          <span>
                            주차 <b className="neutral">총 {place.capacity}면</b>
                            <small>
                              {' · '}
                              {evStats.realtimeParkingConfigured ? '실시간 잔여 미제공' : '실시간 정보 연동 전'}
                            </small>
                          </span>
                        ) : (
                          <span>주차 <b className="neutral">면수 확인 필요</b></span>
                        )}

                        {place.charger.total > 0 ? (
                          <>
                            <span>
                              충전 가능 <b className={place.charger.available > 0 ? 'good' : 'bad'}>{place.charger.available}</b>
                              <small> / 총 {place.charger.total}기</small>
                            </span>
                            <span>
                              충전 중 <b>{place.charger.charging}</b>
                              {(place.charger.unavailable ?? 0) > 0 && <small> · 점검/중지 {place.charger.unavailable ?? 0}</small>}
                              {place.charger.statusFresh === false && <small> · 상태 갱신 지연</small>}
                            </span>
                            <span>{typedAvailabilityText(place, 'fast')}</span>
                            <span>{typedAvailabilityText(place, 'slow')}</span>
                          </>
                        ) : (
                          <span className="charger-pending">EV 충전정보 없음</span>
                        )}
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

            <KakaoMap
              places={mapPlaces}
              focusedPlace={mapFocus}
              userLocation={userLocation}
              onSelect={openPlaceDetail}
              onLocate={locate}
            />
          </div>
        </section>
      </main>

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)} aria-label="상세 닫기">×</button>
            <span className="parking-label">{selected.charger.total > 0 ? 'P⚡ MATCHED' : 'P PARKING'}</span>
            <h2>{selected.name}</h2>
            <p className="detail-address">
              {selected.address && selected.address !== '주소 정보 없음'
                ? selected.address
                : (selected.agency || '주소 위치 확인 중')}
            </p>

            <div className="detail-score">
              <div>
                <span>{selected.availableParking != null ? '실시간 주차 가능' : '주차 규모'}</span>
                {selected.availableParking != null ? (
                  <>
                    <strong>
                      {selected.availableParking}
                      <small>{selected.capacity && selected.capacity > 0 ? ` / 총 ${selected.capacity}면` : '면'}</small>
                    </strong>
                    {selected.parkingRealtime && (
                      <small>
                        {selected.parkingRealtimeFresh === false ? '실시간 · 갱신 지연' : '실시간'}
                        {selected.occupiedParking != null ? ` · 현재 주차 ${selected.occupiedParking}대` : ''}
                        {selected.parkingUpdatedAt ? ` · ${selected.parkingUpdatedAt}` : ''}
                      </small>
                    )}
                  </>
                ) : selected.capacity != null && selected.capacity > 0 ? (
                  <>
                    <strong>총 {selected.capacity}<small>면</small></strong>
                    <small>
                      {evStats.realtimeParkingConfigured
                        ? '실시간 잔여 면수는 제공되지 않습니다.'
                        : '실시간 주차정보는 아직 연동되지 않았습니다.'}
                    </small>
                  </>
                ) : (
                  <strong className="neutral">확인 필요</strong>
                )}
              </div>
              <div>
                <span>EV 충전</span>
                {selected.charger.total > 0 ? (
                  <>
                    <strong>{selected.charger.available} <small>/ 총 {selected.charger.total}기</small></strong>
                    <small>
                      충전 중 {selected.charger.charging}기
                      {(selected.charger.unavailable ?? 0) > 0 ? ` · 점검/중지 ${selected.charger.unavailable}기` : ''}
                      {selected.charger.statusFresh === false ? ' · 상태 갱신 지연' : ''}
                    </small>
                  </>
                ) : (
                  <strong className="neutral">정보 미확인</strong>
                )}
              </div>
            </div>

            <dl>
              <div><dt>급속</dt><dd>{typedAvailabilityText(selected, 'fast')}</dd></div>
              <div><dt>완속</dt><dd>{typedAvailabilityText(selected, 'slow')}</dd></div>
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
