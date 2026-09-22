from pathlib import Path
import argparse
import shutil
import subprocess
import sys
from datetime import datetime

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(
            f"[ABORT] 예상한 코드가 없습니다: {label}\n"
            "현재 소스가 다른 버전일 수 있으므로 아무것도 더 수정하지 않습니다."
        )
    return text.replace(old, new, 1)

def run_node(script: Path, cwd: Path) -> None:
    r = subprocess.run(["node", str(script)], cwd=cwd, shell=False)
    if r.returncode != 0:
        raise SystemExit(r.returncode)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preflight", action="store_true")
    ap.add_argument("--release", action="store_true")
    args = ap.parse_args()

    project = Path.cwd()
    preflight = project / "scripts" / "live-remote-preflight.mjs"
    release = project / "scripts" / "release-live.mjs"
    verify = project / "scripts" / "verify-live-local.mjs"
    worker = project / "worker" / "index.ts"

    for p in (preflight, release, verify, worker):
        if not p.exists():
            raise SystemExit(f"[ABORT] 파일을 찾지 못했습니다: {p}")

    worker_text = worker.read_text(encoding="utf-8")
    if "const DATA_LAYER_VERSION = 'v0.7.0.1';" not in worker_text:
        raise SystemExit(
            "[ABORT] worker가 v0.7.0.1 기준이 아닙니다. "
            "v0.7.0.1 type hotfix + v0.7.0.2 local verify까지 먼저 적용되어야 합니다."
        )

    backup = project / ".plugpark" / "recovery-backup-v0.7.0.3"
    backup.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(preflight, backup / f"live-remote-preflight-{stamp}.mjs")
    shutil.copy2(release, backup / f"release-live-{stamp}.mjs")

    p = preflight.read_text(encoding="utf-8")
    p = replace_once(
        p,
        "if (local.dataLayerVersion !== 'v0.7.0') fail(`local version=${local.dataLayerVersion}`);",
        "if (local.dataLayerVersion !== 'v0.7.0.1') fail(`local version=${local.dataLayerVersion}`);",
        "local verify version guard",
    )

    old_parking_block = """if (health.realtimeParkingUrlConfigured) {
  console.log('부산 실시간 주차 URL ... CONFIGURED');
} else {
  console.log('부산 실시간 주차 URL ... NOT CONFIGURED');
  console.log('  → v0.7.0 배포/EV Status는 가능하지만 Parking live sync는 SKIP됩니다.');
  console.log('  → 공공데이터포털 활용신청 화면의 실제 요청 URL을 BUSAN_REALTIME_PARKING_API_URL로 설정해야 최종 주차 실시간 연동이 켜집니다.');
}"""
    new_parking_block = """if (!health.realtimeParkingUrlConfigured) {
  fail(
    'BUSAN_REALTIME_PARKING_API_URL이 Remote Worker에 설정되지 않았습니다.\\n' +
    'v0.7 LIVE FINAL release는 Parking live까지 포함하므로 write/deploy 전에 중단했습니다.\\n' +
    '공공데이터포털 활용신청 화면의 실제 요청 URL을 설정한 뒤 같은 preflight를 다시 실행하세요.'
  );
}
console.log('부산 실시간 주차 URL ... CONFIGURED');"""
    p = replace_once(p, old_parking_block, new_parking_block, "parking URL release guard")
    p = p.replace("PlugPark v0.7.0 LIVE REMOTE PREFLIGHT", "PlugPark v0.7.0.3 LIVE REMOTE PREFLIGHT", 1)
    preflight.write_text(p, encoding="utf-8")

    r = release.read_text(encoding="utf-8")
    r = r.replace("PlugPark v0.7.0 LIVE SAFE RELEASE", "PlugPark v0.7.0.3 LIVE SAFE RELEASE", 1)
    r = replace_once(
        r,
        "if (health.dataLayerVersion !== 'v0.7.0') throw new Error(`배포 버전=${health.dataLayerVersion}`);",
        "if (health.dataLayerVersion !== 'v0.7.0.1') throw new Error(`배포 버전=${health.dataLayerVersion}`);",
        "deployed version guard",
    )
    r = r.replace("console.log('배포 확인 ... PASS · v0.7.0');", "console.log('배포 확인 ... PASS · v0.7.0.1');", 1)

    old_sync = """const ev = await postOnce('/api/admin/live-sync?kind=ev&mode=incremental', token, 'EV Status incremental sync');
let parking = { skipped: true, reason: 'REALTIME_PARKING_URL_NOT_CONFIGURED' };
if (health.realtimeParkingUrlConfigured) {
  parking = await postOnce('/api/admin/live-sync?kind=parking&mode=incremental', token, 'Parking realtime sync');
} else {
  console.log('Parking realtime sync ... SKIP · BUSAN_REALTIME_PARKING_API_URL 미설정');
}"""
    new_sync = """if (!health.realtimeParkingUrlConfigured) {
  throw new Error('배포 후 BUSAN_REALTIME_PARKING_API_URL이 사라졌습니다. live sync write 전에 중단합니다.');
}
const ev = await postOnce('/api/admin/live-sync?kind=ev&mode=incremental', token, 'EV Status incremental sync');
const parking = await postOnce('/api/admin/live-sync?kind=parking&mode=incremental', token, 'Parking realtime sync');"""
    r = replace_once(r, old_sync, new_sync, "parking sync no-skip guard")

    r = r.replace("if (health.realtimeParkingUrlConfigured && live.parkingRealtime.status !== 'complete') {", "if (live.parkingRealtime.status !== 'complete') {", 1)
    r = r.replace("version: 'v0.7.0',", "version: 'v0.7.0.1',", 1)
    r = r.replace("parkingSyncCalls: health.realtimeParkingUrlConfigured ? 1 : 0,", "parkingSyncCalls: 1,", 1)

    old_tail = """if (health.realtimeParkingUrlConfigured) {
  console.log(`Parking realtime=${live.parkingRealtime.itemCount}곳 · fresh=${live.parkingRealtime.fresh}`);
} else {
  console.log('Parking realtime=URL 미설정으로 SKIP');
}"""
    new_tail = """console.log(`Parking realtime=${live.parkingRealtime.itemCount}곳 · fresh=${live.parkingRealtime.fresh}`);"""
    r = replace_once(r, old_tail, new_tail, "release result no-skip summary")
    release.write_text(r, encoding="utf-8")

    print("PASS · live-remote-preflight.mjs v0.7.0.1 기대값 반영")
    print("PASS · Parking live URL 미설정 시 remote write/deploy 전 중단")
    print("PASS · release-live.mjs v0.7.0.1 배포 검증")
    print("PASS · Parking live sync SKIP 제거 — 최종 release는 EV+Parking 둘 다 1회")
    print(f"backup · {backup}")

    # scripts가 바뀌었으므로 이전 baseline은 무효다.
    # remote write 0인 local verify를 먼저 다시 실행해 새 baseline을 만든다.
    print("\n[1/2] LOCAL VERIFY 재생성 (remote write 0 · 실제 공공 API call 0)")
    run_node(verify, project)

    if args.preflight or args.release:
        print("\n[2/2] READ-ONLY REMOTE PREFLIGHT")
        run_node(preflight, project)

    if args.release:
        print("\n[RELEASE] preflight PASS 후 원격 1회 release")
        print("※ release-live.mjs가 안전을 위해 local verify + read-only preflight를 한 번 더 확인한 뒤 write를 시작합니다.")
        run_node(release, project)

if __name__ == "__main__":
    main()
