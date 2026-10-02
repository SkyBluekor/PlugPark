import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { PlugParkPlace } from '../types';

type UserLocation = { lat: number; lng: number } | null;
type RadiusKm = 1 | 3 | 5 | null;
type BridgeStatus = 'idle' | 'checking' | 'online' | 'offline';

type Props = {
  userLocation: UserLocation;
  radiusKm: RadiusKm;
  places: PlugParkPlace[];
  onFocusMap: (place: PlugParkPlace) => void;
  onOpenDetail: (place: PlugParkPlace) => void;
};

type AiPlaceReference = {
  id: string;
  name: string;
  address?: string | null;
  distanceMeters?: number | null;
  rank?: number | null;
  parking?: {
    capacity?: number | null;
    available?: number | null;
  };
  charging?: {
    totalAvailable?: number | null;
    fastAvailable?: number | null;
    slowAvailable?: number | null;
  };
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  places?: AiPlaceReference[];
};

type HealthResponse = {
  ok?: boolean;
  provider?: string;
  model?: string;
  mcp?: boolean;
  reason?: string;
};

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3000';

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `plugpark-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const BUSAN_BOUNDS = {
  minLat: 34.8,
  maxLat: 35.45,
  minLng: 128.7,
  maxLng: 129.4,
} as const;

function isBusanCoordinates(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= BUSAN_BOUNDS.minLat &&
    lat <= BUSAN_BOUNDS.maxLat &&
    lng >= BUSAN_BOUNDS.minLng &&
    lng <= BUSAN_BOUNDS.maxLng
  );
}

function extractNearbyLandmark(message: string) {
  const compact = message.replace(/\s+/g, ' ').trim();
  const match = compact.match(/^(.+?)\s*(?:근처|주변|인근)(?:\s|$)/);
  if (!match?.[1]) return '';

  const raw = match[1]
    .replace(/^(?:부산광역시|부산시|부산)\s*/u, '')
    .trim();

  if (!raw || /^(?:내|현재\s*위치)$/u.test(raw)) return '';

  return raw;
}

function normalizePlaceLookupText(value: string) {
  return value
    .toLowerCase()
    .replace(/부산광역시|부산시/g, '부산')
    .replace(/[\s,\.·ㆍ()\[\]{}\-_\/]/g, '')
    .trim();
}

function buildLandmarkQueries(rawLandmark: string) {
  const clean = rawLandmark.replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ').filter(Boolean);
  const district = tokens.find((token) => /^[가-힣]+구$/.test(token)) || '';
  const rest = tokens.filter((token) => token !== district);
  const restText = rest.join(' ').trim();

  const queries = [
    `부산 ${clean}`,
    district && restText ? `부산 ${district} ${restText}` : '',
    district && restText ? `부산 ${restText} ${district}` : '',
    clean,
  ];

  if (/폴리텍/.test(restText || clean) && !/대학/.test(restText || clean)) {
    const expanded = (restText || clean).replace(/폴리텍/g, '폴리텍대학');
    queries.push(
      district ? `부산 ${district} ${expanded}` : `부산 ${expanded}`,
      district ? `부산 ${expanded} ${district}` : '',
      '한국폴리텍대학 부산캠퍼스',
    );
  }

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

function landmarkCandidateScore(rawLandmark: string, item: any) {
  const lat = Number(item?.y);
  const lng = Number(item?.x);
  if (!isBusanCoordinates(lat, lng)) return Number.NEGATIVE_INFINITY;

  const rawTokens = rawLandmark
    .replace(/^(?:부산광역시|부산시|부산)\s*/u, '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const name = String(item?.place_name || '');
  const address = `${String(item?.road_address_name || '')} ${String(item?.address_name || '')}`;
  const haystack = `${name} ${address}`;
  const normalizedHaystack = normalizePlaceLookupText(haystack);

  let score = 0;

  for (const token of rawTokens) {
    const normalizedToken = normalizePlaceLookupText(token);
    if (!normalizedToken) continue;

    if (normalizePlaceLookupText(name).includes(normalizedToken)) {
      score += /^[가-힣]+구$/.test(token) ? 18 : 42;
    } else if (normalizedHaystack.includes(normalizedToken)) {
      score += /^[가-힣]+구$/.test(token) ? 26 : 20;
    }
  }

  if (/폴리텍/.test(rawLandmark) && /폴리텍/.test(name)) score += 55;
  if (/대학/.test(rawLandmark) && /대학/.test(name)) score += 18;
  if (/캠퍼스/.test(name)) score += 5;

  return score;
}

async function waitForKakaoServices(timeoutMs = 5000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const services = window.kakao?.maps?.services;
    if (services?.Places && services?.Status) return services;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  return null;
}

async function kakaoKeywordSearch(services: any, query: string) {
  return await new Promise<any[]>((resolve) => {
    const placesService = new services.Places();

    placesService.keywordSearch(
      query,
      (result: any[], status: string) => {
        resolve(
          status === services.Status.OK && Array.isArray(result)
            ? result
            : [],
        );
      },
      { size: 15 },
    );
  });
}

async function resolveNearbyLandmark(message: string) {
  const rawLandmark = extractNearbyLandmark(message);
  if (!rawLandmark) return null;

  const services = await waitForKakaoServices();
  if (!services) return null;

  const candidates: any[] = [];
  const seen = new Set<string>();

  for (const query of buildLandmarkQueries(rawLandmark)) {
    const results = await kakaoKeywordSearch(services, query);

    for (const item of results) {
      const key = `${item?.id || ''}|${item?.x || ''}|${item?.y || ''}|${item?.place_name || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(item);
    }
  }

  const ranked = candidates
    .map((item) => ({
      item,
      score: landmarkCandidateScore(rawLandmark, item),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 35) return null;

  const lat = Number(best.item?.y);
  const lng = Number(best.item?.x);

  return {
    name: String(best.item?.place_name || rawLandmark).trim() || rawLandmark,
    lat,
    lng,
    rawLandmark,
  };
}

function formatAiDistance(distanceMeters?: number | null) {
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) return '';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)}m`;
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

function compactPlaceStatus(place: AiPlaceReference) {
  const parts: string[] = [];
  const available = place.parking?.available;
  const capacity = place.parking?.capacity;
  const fast = place.charging?.fastAvailable;
  const slow = place.charging?.slowAvailable;
  const total = place.charging?.totalAvailable;

  if (available != null) {
    parts.push(`주차 ${available}${capacity != null ? ` / ${capacity}면` : '면'}`);
  } else if (capacity != null) {
    parts.push(`주차 총 ${capacity}면`);
  }

  if (fast != null && fast > 0) {
    parts.push(`급속 ${fast}기 가능`);
  } else if (slow != null && slow > 0) {
    parts.push(`완속 ${slow}기 가능`);
  } else if (total != null) {
    parts.push(`충전 ${total}기 가능`);
  }

  return parts.join(' · ');
}

export default function PlugParkAiChat({
  userLocation,
  radiusKm,
  places,
  onFocusMap,
  onOpenDetail,
}: Props) {
  const bridgeUrl = useMemo(
    () => import.meta.env.VITE_LOCAL_AI_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL,
    [],
  );
  const sessionIdRef = useRef(createSessionId());
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BridgeStatus>('idle');
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && status === 'idle') {
      void checkHealth();
    }
  }, [open, status]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, sending, open]);

  async function checkHealth() {
    setStatus('checking');

    try {
      const response = await fetch(`${bridgeUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const data = (await response.json()) as HealthResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.reason || 'offline');
      }

      setModel(data.model || '');
      setStatus('online');
    } catch {
      setStatus('offline');
    }
  }

  async function resetConversation() {
    const previousSessionId = sessionIdRef.current;
    sessionIdRef.current = createSessionId();
    setMessages([]);

    if (status !== 'online') return;

    try {
      await fetch(`${bridgeUrl}/api/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: previousSessionId }),
      });
    } catch {
      // Local AI is optional. A failed reset must not affect PlugPark itself.
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();

    const message = input.trim();
    if (!message || sending || status !== 'online') return;

    const userMessage: ChatMessage = {
      id: createSessionId(),
      role: 'user',
      text: message,
    };

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setSending(true);

    try {
      const nearbyLandmark = extractNearbyLandmark(message);
      const targetLocation = await resolveNearbyLandmark(message);

      const response = await fetch(`${bridgeUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message,
          context: {
            userLat: userLocation?.lat ?? null,
            userLng: userLocation?.lng ?? null,
            radiusKm,
            targetLat: targetLocation?.lat ?? null,
            targetLng: targetLocation?.lng ?? null,
            targetName: targetLocation?.name ?? null,
            targetQuery: nearbyLandmark || null,
            targetResolveFailed: Boolean(nearbyLandmark && !targetLocation),
          },
        }),
      });

      const data = (await response.json()) as {
        answer?: string;
        places?: AiPlaceReference[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || 'AI 응답을 가져오지 못했습니다.');
      }

      setMessages((current) => [
        ...current,
        {
          id: createSessionId(),
          role: 'assistant',
          text: data.answer?.trim() || '응답이 없습니다.',
          places: Array.isArray(data.places) ? data.places : [],
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: createSessionId(),
          role: 'assistant',
          text: '로컬 AI 연결에 실패했습니다. Ollama와 PlugPark AI Bridge가 실행 중인지 확인해주세요.',
        },
      ]);
      setStatus('offline');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        className={`ai-chat-launcher ${status === 'online' ? 'online' : ''}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="plugpark-ai-panel"
      >
        <span className="ai-chat-dot" aria-hidden="true" />
        <span>AI</span>
      </button>

      {open && (
        <aside className="ai-chat-panel" id="plugpark-ai-panel" aria-label="PlugPark AI">
          <header className="ai-chat-header">
            <div>
              <strong>PlugPark AI</strong>
              <span>
                {status === 'online'
                  ? `로컬 AI 연결됨${model ? ` · ${model}` : ''}`
                  : status === 'checking'
                    ? '로컬 AI 확인 중…'
                    : '주차·충전 정보를 자연어로 물어보세요'}
              </span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="AI 채팅 닫기">×</button>
          </header>

          <div className="ai-chat-body">
            {status === 'checking' && (
              <div className="ai-chat-state">
                <strong>로컬 AI를 확인하고 있습니다.</strong>
                <span>잠시만 기다려주세요.</span>
              </div>
            )}

            {status === 'offline' && (
              <div className="ai-chat-state offline">
                <strong>로컬 AI가 연결되어 있지 않습니다.</strong>
                <span>PC에서 Ollama와 PlugPark AI Bridge를 실행하면 이 채팅을 사용할 수 있습니다.</span>
                <small>브라우저가 로컬 네트워크 또는 이 기기의 로컬 서비스 접근 권한을 묻는 경우 허용해주세요.</small>
                <button type="button" onClick={() => void checkHealth()}>다시 연결</button>
              </div>
            )}

            {(status === 'idle' || status === 'online') && messages.length === 0 && (
              <div className="ai-chat-welcome">
                <strong>어디에 주차하거나 충전할지 물어보세요.</strong>
                <span>예: 해운대 근처 급속 충전 가능한 공영주차장 찾아줘</span>
                {userLocation && (
                  <small>
                    현재 위치가 연결되어 있어 “내 근처”라고 물으면 위치 기반 추천에 활용됩니다.
                  </small>
                )}
              </div>
            )}

            {messages.map((message) => (
              <div className={`ai-chat-message ${message.role}`} key={message.id}>
                <span>{message.role === 'user' ? '나' : 'AI'}</span>
                <div className="ai-chat-message-content">
                  <p>{message.text}</p>

                  {message.role === 'assistant' && message.places && message.places.length > 0 && (
                    <div className="ai-place-cards" aria-label="AI 관련 장소">
                      {message.places.map((placeRef) => {
                        const currentPlace = places.find((place) => place.id === placeRef.id);
                        const statusText = compactPlaceStatus(placeRef);

                        return (
                          <article className={`ai-place-card ${currentPlace ? '' : 'unavailable'}`} key={placeRef.id}>
                            <div className="ai-place-card-copy">
                              <strong>
                                {placeRef.rank != null ? `${placeRef.rank}. ` : ''}
                                {placeRef.name}
                              </strong>
                              {(formatAiDistance(placeRef.distanceMeters) || statusText) && (
                                <span>
                                  {[formatAiDistance(placeRef.distanceMeters), statusText]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              )}
                              {!currentPlace && (
                                <small>AI 데이터에는 있지만 현재 화면 데이터에서는 찾을 수 없습니다.</small>
                              )}
                            </div>
                            <div className="ai-place-card-actions">
                              <button
                                type="button"
                                disabled={!currentPlace}
                                onClick={() => {
                                  if (!currentPlace) return;
                                  setOpen(false);
                                  onFocusMap(currentPlace);
                                }}
                              >
                                지도
                              </button>
                              <button
                                type="button"
                                disabled={!currentPlace}
                                onClick={() => {
                                  if (!currentPlace) return;
                                  setOpen(false);
                                  onOpenDetail(currentPlace);
                                }}
                              >
                                상세
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="ai-chat-message assistant pending">
                <span>AI</span>
                <p>PlugPark 정보를 확인하는 중…</p>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <footer className="ai-chat-footer">
            <div className="ai-chat-footer-actions">
              <span>{status === 'online' ? 'MCP 연결 사용' : 'AI 기능은 선택 사항입니다.'}</span>
              <button type="button" onClick={() => void resetConversation()}>대화 초기화</button>
            </div>
            <form onSubmit={(event) => void sendMessage(event)}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={status === 'online' ? 'PlugPark에 물어보기…' : '로컬 AI 연결 후 사용할 수 있습니다.'}
                rows={2}
                disabled={status !== 'online' || sending}
              />
              <button type="submit" disabled={status !== 'online' || sending || !input.trim()}>
                전송
              </button>
            </form>
          </footer>
        </aside>
      )}
    </>
  );
}
