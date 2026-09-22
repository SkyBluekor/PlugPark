from pathlib import Path
import json, re, shutil, subprocess, sys

ROOT = Path.cwd()
WORKER = ROOT / 'worker' / 'index.ts'
PACKAGE = ROOT / 'package.json'
WRANGLER = ROOT / 'wrangler.toml'
PAYLOAD = Path(__file__).resolve().parent / 'payload'
BACKUP = ROOT / '.plugpark' / 'recovery-backup-v0.7.0'

FILES = [
    'worker/index.ts',
    'src/App.tsx',
    'src/types.ts',
    'package.json',
    'migrations/0003_v0_7_0_live_data.sql',
    'scripts/source-baseline.mjs',
    'scripts/verify-live-local.mjs',
    'scripts/live-remote-preflight.mjs',
    'scripts/release-live.mjs',
    'scripts/live-state-remote.mjs',
]

def fail(msg):
    print(f'\n[ABORT] {msg}')
    raise SystemExit(2)

def patch_triggers(text: str) -> str:
    cron_line = 'crons = ["*/5 * * * *"]'
    m = re.search(r'(?m)^\[triggers\]\s*$', text)
    if not m:
        suffix = '' if text.endswith('\n') else '\n'
        return text + suffix + '\n# PlugPark v0.7.0 live sync: parking 5분 / EV는 handler에서 10분 cadence\n[triggers]\n' + cron_line + '\n'

    start = m.end()
    next_section = re.search(r'(?m)^\[[^\[][^]]*\]\s*$', text[start:])
    end = start + next_section.start() if next_section else len(text)
    block = text[start:end]
    if re.search(r'(?m)^\s*crons\s*=', block):
        block = re.sub(r'(?m)^\s*crons\s*=.*$', cron_line, block, count=1)
    else:
        block = block.rstrip() + '\n' + cron_line + '\n'
    return text[:start] + block + text[end:]

if not WORKER.exists() or not PACKAGE.exists() or not WRANGLER.exists():
    fail('PlugPark 프로젝트 루트에서 실행하세요. worker/index.ts, package.json, wrangler.toml이 필요합니다.')

pkg = json.loads(PACKAGE.read_text(encoding='utf-8'))
worker = WORKER.read_text(encoding='utf-8')

if pkg.get('name') != 'plugpark':
    fail('package.json name이 plugpark가 아닙니다.')

already = "const DATA_LAYER_VERSION = 'v0.7.0';" in worker
if not already:
    required = [
        "const DATA_LAYER_VERSION = 'v0.6.2.1';",
        "async function syncParkingRealtime"  # v0.7에는 생기므로 old source에는 없어야 함
    ]
    # 첫 marker만 필수. 두 번째는 absence를 확인합니다.
    if required[0] not in worker:
        fail('현재 소스가 검증된 v0.6.2.1 기준선과 다릅니다. 아무 파일도 수정하지 않았습니다.')
    if required[1] in worker:
        fail('현재 worker에 예상하지 못한 live-sync 구현이 이미 있습니다. 덮어쓰지 않습니다.')
    if pkg.get('version') not in ('0.6.2-1', '0.6.2.1'):
        fail(f"package version이 예상과 다릅니다: {pkg.get('version')}")

BACKUP.mkdir(parents=True, exist_ok=True)
for rel in FILES:
    src = ROOT / rel
    if src.exists():
        dst = BACKUP / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

wrangler_backup = BACKUP / 'wrangler.toml'
shutil.copy2(WRANGLER, wrangler_backup)

for rel in FILES:
    src = PAYLOAD / rel
    if not src.exists():
        fail(f'payload 누락: {rel}')
    dst = ROOT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

WRANGLER.write_text(patch_triggers(WRANGLER.read_text(encoding='utf-8')), encoding='utf-8')

print('\n[APPLIED] PlugPark v0.7.0 LIVE DATA LOCAL-FIRST')
print('변경:')
print(' - EV Status: 최근 10분 증분 수집 + changed-row only D1 write')
print(' - EV station live summary: 영향받은 station만 재계산')
print(' - Parking realtime: 100건 snapshot chunk 방식')
print(' - /api/places: 사용자 요청 upstream API call 0')
print(' - 5분 Cron, EV는 handler 내부에서 10분 cadence')
print(' - D1/API safety budget + quota/auth 무한재시도 없음')
print(f'백업: {BACKUP}')
print('※ BUSAN_REALTIME_PARKING_API_URL은 실제 공공데이터포털 요청 URL을 별도로 설정해야 remote parking live가 켜집니다.')

if '--verify' in sys.argv:
    print('\n[RUN] npm run verify:live-local')
    r = subprocess.run(
        ['npm.cmd' if sys.platform.startswith('win') else 'npm', 'run', 'verify:live-local'],
        cwd=ROOT,
    )
    raise SystemExit(r.returncode)

if '--release' in sys.argv:
    print('\n[RUN] npm run release:live')
    r = subprocess.run(
        ['npm.cmd' if sys.platform.startswith('win') else 'npm', 'run', 'release:live'],
        cwd=ROOT,
    )
    raise SystemExit(r.returncode)
