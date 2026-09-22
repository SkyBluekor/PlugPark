from pathlib import Path
import json, shutil, subprocess, sys

ROOT = Path.cwd()
WORKER = ROOT / 'worker' / 'index.ts'
PACKAGE = ROOT / 'package.json'
PAYLOAD = Path(__file__).resolve().parent / 'hotfix_payload'
BACKUP = ROOT / '.plugpark' / 'recovery-backup-v0.6.2.1'

def fail(msg):
    print(f'\n[ABORT] {msg}')
    raise SystemExit(2)

if not WORKER.exists() or not PACKAGE.exists():
    fail('PlugPark 프로젝트 루트에서 실행하세요.')

pkg = json.loads(PACKAGE.read_text(encoding='utf-8'))
worker = WORKER.read_text(encoding='utf-8')
if pkg.get('name') != 'plugpark':
    fail('package.json name이 plugpark가 아닙니다.')

already = "const DATA_LAYER_VERSION = 'v0.6.2.1';" in worker
if not already:
    required = [
        "const DATA_LAYER_VERSION = 'v0.6.2';",
        'async function replaceParkingReadModel(db: D1Database, items: ParkingBase[])',
        'await db.batch(statements);',
        "const baseItems = baseParsed.valid.map(normalizeBaseParking);",
    ]
    missing = [x for x in required if x not in worker]
    if missing:
        fail('현재 소스가 v0.6.2 배포 직후 구조와 다릅니다. 아무 파일도 수정하지 않았습니다.\n누락: ' + ', '.join(missing))

files = [
    'worker/index.ts', 'package.json',
    'scripts/local-recovery-verify.mjs', 'scripts/remote-preflight.mjs',
    'scripts/verify-v0.6.mjs', 'scripts/remote-resume-parking.mjs',
    'tests/fixtures/local-recovery-seed.sql',
]
BACKUP.mkdir(parents=True, exist_ok=True)
for rel in files:
    src = ROOT / rel
    if src.exists():
        dst = BACKUP / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

for rel in files:
    src = PAYLOAD / rel
    if not src.exists():
        fail(f'payload 누락: {rel}')
    dst = ROOT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

print('\n[APPLIED] PlugPark v0.6.2.1 parking-id dedupe hotfix')
print('원인: remote parking API 결과에 동일 parking_id가 중복되어 PRIMARY KEY 충돌')
print('수정: API base 1차 dedupe + read-model write 직전 PK 2차 dedupe + fallback ID에 주소 포함')
print('검증 fixture에도 동일 parking_id 중복 상황을 추가했습니다.')

if '--resume' in sys.argv:
    print('\n[RUN] npm run release:resume')
    r = subprocess.run(['npm.cmd' if sys.platform.startswith('win') else 'npm', 'run', 'release:resume'], cwd=ROOT)
    raise SystemExit(r.returncode)
