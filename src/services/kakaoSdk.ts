let sdkPromise: Promise<any> | null = null;
let runtimeKeyPromise: Promise<string> | null = null;

function getRuntimeMapKey(): Promise<string> {
  if (!runtimeKeyPromise) {
    runtimeKeyPromise = fetch('/api/client-config', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    }).then(async (response) => {
      if (!response.ok) throw new Error('KAKAO_APP_KEY_MISSING');
      const config = await response.json() as { ok?: boolean; kakaoMapJsKey?: unknown };
      const key = typeof config.kakaoMapJsKey === 'string' ? config.kakaoMapJsKey.trim() : '';
      if (!config.ok || !key) throw new Error('KAKAO_APP_KEY_MISSING');
      return key;
    }).catch((error) => {
      runtimeKeyPromise = null;
      throw error;
    });
  }
  return runtimeKeyPromise;
}

declare global {
  interface Window {
    kakao?: any;
  }
}

export const BUSAN_BOUNDS = {
  minLat: 34.8,
  maxLat: 35.45,
  minLng: 128.7,
  maxLng: 129.4,
} as const;

export function isBusanCoordinates(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= BUSAN_BOUNDS.minLat &&
    lat <= BUSAN_BOUNDS.maxLat &&
    lng >= BUSAN_BOUNDS.minLng &&
    lng <= BUSAN_BOUNDS.maxLng
  );
}

export function loadKakaoMapSdk(appKey: string): Promise<any> {
  const key = appKey.trim();
  if (!key) {
    // Cloudflare runtime secrets are independent of the Vite build environment.
    // Fetch only the public JavaScript SDK key when it was not baked into the bundle.
    return getRuntimeMapKey().then((runtimeKey) => loadKakaoMapSdk(runtimeKey));
  }

  if (window.kakao?.maps) {
    return new Promise<any>((resolve, reject) => {
      try {
        window.kakao.maps.load(() => {
          if (window.kakao?.maps?.services) {
            resolve(window.kakao);
            return;
          }
          reject(new Error('KAKAO_SERVICES_UNAVAILABLE'));
        });
      } catch {
        reject(new Error('KAKAO_SDK_LOAD_FAILED'));
      }
    });
  }

  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const fail = (reason: string) => {
      window.clearTimeout(timeout);
      sdkPromise = null;
      document.querySelector('script[data-plugpark-kakao-map]')?.remove();
      reject(new Error(reason));
    };
    const timeout = window.setTimeout(() => fail('KAKAO_SDK_LOAD_TIMEOUT'), 12000);
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-plugpark-kakao-map]',
    );

    const finish = () => {
      if (!window.kakao?.maps) {
        fail('KAKAO_SDK_OBJECT_MISSING');
        return;
      }

      window.kakao.maps.load(() => {
        if (!window.kakao?.maps?.services) {
          fail('KAKAO_SERVICES_UNAVAILABLE');
          return;
        }
        window.clearTimeout(timeout);
        resolve(window.kakao);
      });
    };

    if (existing) {
      if (window.kakao?.maps) {
        finish();
        return;
      }

      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener(
        'error',
        () => {
          fail('KAKAO_SDK_LOAD_FAILED');
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.dataset.plugparkKakaoMap = 'true';
    script.async = true;
    script.src =
      'https://dapi.kakao.com/v2/maps/sdk.js' +
      `?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`;
    script.onload = finish;
    script.onerror = () => {
      fail('KAKAO_SDK_LOAD_FAILED');
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

export async function kakaoKeywordSearch(
  kakao: any,
  query: string,
  size = 15,
): Promise<any[]> {
  const services = kakao?.maps?.services;
  const keyword = query.trim();

  if (!services?.Places || !services?.Status || !keyword) {
    return [];
  }

  return await new Promise<any[]>((resolve) => {
    const places = new services.Places();
    places.keywordSearch(
      keyword,
      (result: any[], status: string) => {
        resolve(
          status === services.Status.OK && Array.isArray(result)
            ? result
            : [],
        );
      },
      { size },
    );
  });
}


export type KakaoAddressAnalyzeType = 'EXACT' | 'SIMILAR';

export async function kakaoAddressSearch(
  kakao: any,
  address: string,
  analyzeType: KakaoAddressAnalyzeType = 'SIMILAR',
  size = 30,
): Promise<any[]> {
  const services = kakao?.maps?.services;
  const query = address.trim();

  if (!services?.Geocoder || !services?.Status || !query) {
    return [];
  }

  return await new Promise<any[]>((resolve) => {
    const geocoder = new services.Geocoder();
    const analyze =
      analyzeType === 'EXACT'
        ? services.AnalyzeType?.EXACT
        : services.AnalyzeType?.SIMILAR;

    const options: Record<string, unknown> = {
      size: Math.max(1, Math.min(30, Math.trunc(size))),
    };

    if (analyze) options.analyze_type = analyze;

    geocoder.addressSearch(
      query,
      (result: any[], status: string) => {
        resolve(
          status === services.Status.OK && Array.isArray(result)
            ? result
            : [],
        );
      },
      options,
    );
  });
}

export async function kakaoCoord2RegionCode(
  kakao: any,
  lng: number,
  lat: number,
): Promise<any[]> {
  const services = kakao?.maps?.services;

  if (
    !services?.Geocoder ||
    !services?.Status ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return [];
  }

  return await new Promise<any[]>((resolve) => {
    const geocoder = new services.Geocoder();

    geocoder.coord2RegionCode(
      lng,
      lat,
      (result: any[], status: string) => {
        resolve(
          status === services.Status.OK && Array.isArray(result)
            ? result
            : [],
        );
      },
    );
  });
}
