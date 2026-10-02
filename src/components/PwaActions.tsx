import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandaloneMode() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export default function PwaActions() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);

  const appUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);

  useEffect(() => {
    setInstalled(isStandaloneMode());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
      }
      return;
    }

    if (isIosDevice()) {
      setIosHelpOpen(true);
    }
  }

  const showInstall = !installed && (Boolean(installPrompt) || isIosDevice());

  return (
    <>
      <div className="pwa-actions" aria-label="앱 설치 및 모바일 열기">
        {showInstall && (
          <button className="pwa-action-button install" type="button" onClick={() => void install()}>
            앱처럼 설치
          </button>
        )}
        <button className="pwa-action-button qr" type="button" onClick={() => setQrOpen(true)}>
          휴대폰에서 열기
        </button>
      </div>

      {qrOpen && (
        <div className="pwa-modal-backdrop" role="presentation" onClick={() => setQrOpen(false)}>
          <section
            className="pwa-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugpark-qr-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="pwa-modal-close" type="button" onClick={() => setQrOpen(false)} aria-label="닫기">
              ×
            </button>
            <p className="pwa-modal-kicker">MOBILE ACCESS</p>
            <h2 id="plugpark-qr-title">휴대폰에서 PlugPark 열기</h2>
            <p>휴대폰 카메라로 QR을 스캔하면 현재 PlugPark 주소로 바로 이동합니다.</p>
            <div className="pwa-qr-frame">
              <QRCodeSVG
                value={appUrl}
                size={220}
                level="M"
                marginSize={2}
                title="PlugPark 접속 QR 코드"
              />
            </div>
            <strong className="pwa-url">{appUrl}</strong>
            <small>접속 후 홈 화면에 추가하면 다음부터 아이콘으로 바로 실행할 수 있습니다.</small>
          </section>
        </div>
      )}

      {iosHelpOpen && (
        <div className="pwa-modal-backdrop" role="presentation" onClick={() => setIosHelpOpen(false)}>
          <section
            className="pwa-modal pwa-ios-help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugpark-ios-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="pwa-modal-close" type="button" onClick={() => setIosHelpOpen(false)} aria-label="닫기">
              ×
            </button>
            <p className="pwa-modal-kicker">IPHONE / IPAD</p>
            <h2 id="plugpark-ios-title">홈 화면에 추가하기</h2>
            <ol>
              <li>Safari의 <b>공유</b> 버튼을 누릅니다.</li>
              <li><b>홈 화면에 추가</b>를 선택합니다.</li>
              <li>추가 후 PlugPark 아이콘으로 실행합니다.</li>
            </ol>
          </section>
        </div>
      )}
    </>
  );
}
