let sdkPromise: Promise<any> | null = null;

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

export function loadKakaoMapSdk(appKey: string) {
  const key = appKey.trim();
  if (!key) {
    return Promise.reject(new Error('KAKAO_APP_KEY_MISSING'));
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
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-plugpark-kakao-map]',
    );

    const finish = () => {
      if (!window.kakao?.maps) {
        sdkPromise = null;
        reject(new Error('KAKAO_SDK_OBJECT_MISSING'));
        return;
      }

      window.kakao.maps.load(() => {
        if (!window.kakao?.maps?.services) {
          sdkPromise = null;
          reject(new Error('KAKAO_SERVICES_UNAVAILABLE'));
          return;
        }
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
          sdkPromise = null;
          reject(new Error('KAKAO_SDK_LOAD_FAILED'));
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
      sdkPromise = null;
      reject(new Error('KAKAO_SDK_LOAD_FAILED'));
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
