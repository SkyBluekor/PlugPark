import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { PlugParkPlace } from '../types';
import { resolveNearbyLandmark } from '../services/locationResolver';
import {
  isLikelyLocationClarification,
  parseLocationIntent,
  replaceNearbyLandmark,
} from '../services/locationIntent';

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

type PendingNearbyRequest = {
  originalRequest: string;
  failedLandmark: string;
};

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
  const [pendingNearby, setPendingNearby] = useState<PendingNearbyRequest | null>(null);
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
    setPendingNearby(null);

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
      const inputIntent = parseLocationIntent(message);
      const useClarification =
        Boolean(pendingNearby) &&
        !inputIntent.isNearbyRequest &&
        isLikelyLocationClarification(message);

      const effectiveMessage =
        useClarification && pendingNearby
          ? replaceNearbyLandmark(pendingNearby.originalRequest, message)
          : message;

      const effectiveIntent = parseLocationIntent(effectiveMessage);
      const nearbyLandmark = effectiveIntent.locationText ?? '';
      const appKey = import.meta.env.VITE_KAKAO_MAP_JS_KEY?.trim() || '';
      const locationResult =
        effectiveIntent.isNearbyRequest &&
        effectiveIntent.source !== 'current-location' &&
        nearbyLandmark
          ? await resolveNearbyLandmark(appKey, effectiveMessage)
          : null;

      const targetLocation =
        locationResult && locationResult.ok
          ? locationResult
          : null;

      const resolveFailed = Boolean(
        nearbyLandmark &&
        locationResult &&
        !locationResult.ok,
      );

      if (resolveFailed) {
        setPendingNearby({
          originalRequest: effectiveMessage,
          failedLandmark: nearbyLandmark,
        });
      } else if (nearbyLandmark) {
        setPendingNearby(null);
      }

      const response = await fetch(`${bridgeUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: effectiveMessage,
          context: {
            userLat: userLocation?.lat ?? null,
            userLng: userLocation?.lng ?? null,
            radiusKm,
            targetLat: targetLocation?.lat ?? null,
            targetLng: targetLocation?.lng ?? null,
            targetName: targetLocation?.name ?? null,
            targetQuery: nearbyLandmark || null,
            targetResolveFailed: resolveFailed,
            targetResolveReason:
              locationResult && !locationResult.ok
                ? locationResult.reason
                : null,
            targetResolveQueries: locationResult?.queries ?? [],
            targetCandidateCount: locationResult?.candidateCount ?? 0,
            targetScore:
              locationResult && locationResult.ok
                ? locationResult.score
                : (locationResult?.bestScore ?? null),
            locationIntentInput: message,
            locationIntentSource: effectiveIntent.source,
            locationIntentText: effectiveIntent.locationText,
            locationIntentNearby: effectiveIntent.isNearbyRequest,
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
