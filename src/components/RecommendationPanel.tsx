import type { PlugParkPlace } from '../types';
import { chargerSelectionText } from '../presentation/chargerText';
import type {
  ChargerPreference,
  PlaceRecommendation,
  RecommendationMode,
} from '../recommendation/recommendationTypes';

type RecommendationPanelProps = {
  recommendations: PlaceRecommendation[];
  mode: RecommendationMode;
  chargerPreference: ChargerPreference;
  hasLocation: boolean;
  onModeChange: (value: RecommendationMode) => void;
  onChargerPreferenceChange: (value: ChargerPreference) => void;
  onLocate: () => void;
  onFocusMap: (place: PlugParkPlace) => void;
  onOpenDetail: (place: PlugParkPlace) => void;
  focusedPlaceId: string | null;
  getDirectionsUrl: (place: PlugParkPlace) => string;
};

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export default function RecommendationPanel({
  recommendations,
  mode,
  chargerPreference,
  hasLocation,
  onModeChange,
  onChargerPreferenceChange,
  onLocate,
  onFocusMap,
  onOpenDetail,
  focusedPlaceId,
  getDirectionsUrl,
}: RecommendationPanelProps) {
  return (
    <section className="recommendation-panel" aria-labelledby="recommendation-title">
      <div className="recommendation-heading">
        <div>
          <p className="recommendation-kicker">NEARBY DECISION</p>
          <h3 id="recommendation-title">지금 갈 만한 곳</h3>
        </div>
        {hasLocation && (
          <span className="recommendation-count">
            {recommendations.length > 0 ? `${recommendations.length}곳 추천` : '추천 후보 없음'}
          </span>
        )}
      </div>

      {!hasLocation ? (
        <div className="recommendation-location-empty">
          <div>
            <strong>내 위치를 기준으로 바로 비교해보세요.</strong>
            <p>주차 여유와 충전 상태, 거리를 함께 보고 갈 만한 곳을 추립니다.</p>
          </div>
          <button type="button" onClick={onLocate}>내 위치로 추천받기</button>
        </div>
      ) : (
        <>
          <div className="recommendation-controls" aria-label="추천 조건">
            <fieldset>
              <legend>추천 기준</legend>
              <div className="recommendation-toggle">
                <button
                  type="button"
                  aria-pressed={mode === 'parking'}
                  className={mode === 'parking' ? 'active' : ''}
                  onClick={() => onModeChange('parking')}
                >
                  주차 우선
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'charging'}
                  className={mode === 'charging' ? 'active' : ''}
                  onClick={() => onModeChange('charging')}
                >
                  충전 우선
                </button>
              </div>
            </fieldset>

            {mode === 'charging' && (
              <fieldset>
                <legend>충전 방식</legend>
                <div className="recommendation-toggle">
                  {([
                    ['any', '상관없음'],
                    ['fast', '급속'],
                    ['slow', '완속'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={chargerPreference === value}
                      className={chargerPreference === value ? 'active' : ''}
                      onClick={() => onChargerPreferenceChange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>

          {recommendations.length > 0 ? (
            <ol className="recommendation-list">
              {recommendations.map((recommendation, index) => {
                const detailReasons = recommendation.reasons.filter((reason) => !reason.endsWith(' 거리'));
                const nonChargerReasons = detailReasons.filter((reason) => !/(충전|급속|완속)/.test(reason));
                const displayReasons =
                  mode === 'charging'
                    ? [chargerSelectionText(recommendation.place.charger, chargerPreference), ...nonChargerReasons].slice(0, 2)
                    : detailReasons.slice(0, 2);
                const displayWarnings = recommendation.warnings.slice(0, 1);
                return (
                  <li
                    key={recommendation.place.id}
                    className={`recommendation-row ${focusedPlaceId === recommendation.place.id ? 'focused' : ''}`}
                  >
                    <div className="recommendation-rank">{String(index + 1).padStart(2, '0')}</div>

                    <div className="recommendation-main">
                      <div className="recommendation-place-head">
                        <h4>
                          <button
                            type="button"
                            className="recommendation-detail-link"
                            onClick={() => onOpenDetail(recommendation.place)}
                          >
                            {recommendation.place.name}
                          </button>
                        </h4>
                        <span>{formatDistance(recommendation.distanceMeters)}</span>
                      </div>

                      <div className="recommendation-reasons">
                        {displayReasons.map((reason) => <span key={reason}>{reason}</span>)}
                      </div>

                      {displayWarnings.length > 0 && (
                        <div className="recommendation-warnings">
                          {displayWarnings.map((warning) => <span key={warning}>{warning}</span>)}
                        </div>
                      )}
                    </div>

                    <div className="recommendation-actions">
                      <button type="button" onClick={() => onFocusMap(recommendation.place)}>
                        지도에서 보기
                      </button>
                      <a
                        href={getDirectionsUrl(recommendation.place)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        길찾기
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="recommendation-empty">
              <strong>현재 조건에서 추천할 수 있는 장소가 없습니다.</strong>
              <p>반경을 넓히거나 충전 방식을 ‘상관없음’으로 바꿔보세요.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
