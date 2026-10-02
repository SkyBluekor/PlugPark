export type LocationIntentSource =
  | 'explicit'
  | 'residence'
  | 'current-location'
  | 'none';

export type LocationIntent = {
  locationText: string | null;
  isNearbyRequest: boolean;
  source: LocationIntentSource;
};


export type LocationKind =
  | 'administrative'
  | 'address'
  | 'poi'
  | 'current-location'
  | 'unknown';

export function classifyLocationText(value: string | null | undefined): LocationKind {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'unknown';

  if (/^(?:내|현재\s*위치|여기)$/u.test(text)) {
    return 'current-location';
  }

  const addressLike =
    /\d/.test(text) &&
    (
      /(?:대로|로|길|번길|동|가|읍|면|리)\s*\d/u.test(text) ||
      /\d+\s*-\s*\d+/u.test(text)
    );

  if (addressLike) return 'address';

  const tokens = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^(?:부산|부산시|부산광역시)$/u.test(token));

  const administrativeTokens = tokens.filter((token) =>
    /^[가-힣0-9]+(?:동|읍|면|리|구|군|시)$/u.test(token),
  );

  if (
    tokens.length > 0 &&
    administrativeTokens.length === tokens.length
  ) {
    return 'administrative';
  }

  return 'poi';
}

function compactText(value: string) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,.!?])\s*/g, '$1 ')
    .trim();
}

function cleanLocationCandidate(value: string) {
  let result = String(value || '')
    .replace(/^[\s,.;!?]+|[\s,.;!?]+$/g, '')
    .trim();

  result = result
    .replace(/^(?:내가\s*)?사는\s*곳(?:이|은)?\s*/u, '')
    .replace(/^(?:나는|저는)\s*/u, '')
    .replace(/^우리\s*동네(?:가|는)?\s*/u, '')
    .replace(/^(?:지금|현재)\s*/u, '')
    .replace(/^(?:여기가|여기는)\s*/u, '')
    .trim();

  let previous = '';

  while (previous !== result) {
    previous = result;
    result = result
      .replace(
        /\s*(?:살고\s*있는데|살고있는데|사는데|살아|살아요|인데|이야|야|입니다|이고요|이고|에서)\s*$/u,
        '',
      )
      .replace(/[\s,.;!?]+$/g, '')
      .trim();
  }

  return result;
}

function isCurrentLocationExpression(value: string) {
  return [
    /^(?:내|내\s*현재\s*위치)\s*(?:근처|주변|인근)(?:에|에서|으로)?(?:\s|$)/u,
    /(?:현재\s*위치|지금\s*내\s*위치|여기)\s*(?:에서\s*)?(?:근처|주변|인근|가장\s*가까운|가까운|가까이)(?:에|에서|으로)?(?:\s|$)/u,
  ].some((pattern) => pattern.test(value));
}

function hasResidenceContext(value: string) {
  return /(?:사는\s*곳|나는|저는|우리\s*동네|사는데|살고\s*있는데|살고있는데|살아)/u.test(
    value,
  );
}

export function parseLocationIntent(message: string): LocationIntent {
  const compact = compactText(message);
  const isNearbyRequest =
    /(?:근처|주변|인근|가장\s*가까운|가까운|가까이)/u.test(compact);

  if (!isNearbyRequest) {
    return {
      locationText: null,
      isNearbyRequest: false,
      source: 'none',
    };
  }

  if (isCurrentLocationExpression(compact)) {
    return {
      locationText: null,
      isNearbyRequest: true,
      source: 'current-location',
    };
  }

  const patterns = [
    /^(.*?)(?:에서\s*)?(?:가장\s*)?(?:가까운|가까이)(?:\s|$)/u,
    /^(.*?)\s*(?:근처|주변|인근)(?:에|에서|으로|의)?(?:\s|$)/u,
  ];

  let rawCandidate = '';

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match?.[1]) {
      rawCandidate = match[1];
      break;
    }
  }

  if (!rawCandidate) {
    return {
      locationText: null,
      isNearbyRequest: true,
      source: 'none',
    };
  }

  const locationText = cleanLocationCandidate(rawCandidate);

  if (!locationText) {
    return {
      locationText: null,
      isNearbyRequest: true,
      source: 'none',
    };
  }

  if (/^(?:내|현재\s*위치|여기)$/u.test(locationText)) {
    return {
      locationText: null,
      isNearbyRequest: true,
      source: 'current-location',
    };
  }

  if (/^(?:우리\s*집|우리집|내\s*집|내집|집)$/u.test(locationText)) {
    return {
      locationText: null,
      isNearbyRequest: true,
      source: 'none',
    };
  }

  return {
    locationText,
    isNearbyRequest: true,
    source: hasResidenceContext(compact) ? 'residence' : 'explicit',
  };
}

export function extractNearbyLandmark(message: string) {
  return parseLocationIntent(message).locationText ?? '';
}

export function replaceNearbyLandmark(
  originalRequest: string,
  replacementLandmark: string,
) {
  const replacement = compactText(replacementLandmark);
  if (!replacement) return originalRequest;

  const intent = parseLocationIntent(originalRequest);

  if (intent.locationText && originalRequest.includes(intent.locationText)) {
    return originalRequest.replace(intent.locationText, replacement);
  }

  return originalRequest.replace(
    /^(.*?)(\s*(?:근처|주변|인근)(?:에|에서|으로|의)?(?:\s|$))/u,
    `${replacement}$2`,
  );
}

export function isLikelyLocationClarification(message: string) {
  const compact = compactText(message);
  if (!compact || compact.length > 48) return false;

  if (
    /찾아|알려|추천|비교|주차|충전|급속|완속|어디|뭐|있어|보여|바꿔|해줘/u.test(
      compact,
    )
  ) {
    return false;
  }

  return /(?:부산|폴리텍|[가-힣0-9]+(?:동|구|역|대학|학교|캠퍼스|공원|시장|센터|병원|아파트|해수욕장|야구장|터미널))/u.test(
    compact,
  );
}
