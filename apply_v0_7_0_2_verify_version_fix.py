from pathlib import Path
import argparse
import subprocess
import sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()

    project = Path.cwd()
    verify = project / "scripts" / "verify-live-local.mjs"
    if not verify.exists():
        raise SystemExit(f"검증 스크립트를 찾지 못했습니다: {verify}")

    text = verify.read_text(encoding="utf-8")

    replacements = [
        ("health.dataLayerVersion === 'v0.7.0'", "health.dataLayerVersion === 'v0.7.0.1'"),
        ("places.dataLayerVersion === 'v0.7.0'", "places.dataLayerVersion === 'v0.7.0.1'"),
        ("dataLayerVersion: 'v0.7.0',", "dataLayerVersion: 'v0.7.0.1',"),
    ]

    changed = 0
    for old, new in replacements:
        if new in text:
            continue
        if old not in text:
            raise SystemExit(
                f"예상한 검증 코드가 없습니다: {old}\n"
                "현재 소스가 다른 버전일 수 있으므로 아무것도 수정하지 않았습니다."
            )
        text = text.replace(old, new, 1)
        changed += 1

    verify.write_text(text, encoding="utf-8")
    print(f"PASS · verify-live-local.mjs 버전 기대값 수정 ({changed}곳)")

    if args.verify:
        print("\n로컬 LIVE 검증 재실행")
        print("원칙: remote Cloudflare write 0 · 실제 공공 API call 0")
        # Windows .cmd 문제를 피하기 위해 npm을 거치지 않고 Node 스크립트 직접 실행
        r = subprocess.run(
            ["node", str(verify)],
            cwd=project,
            shell=False,
        )
        if r.returncode != 0:
            raise SystemExit(r.returncode)

if __name__ == "__main__":
    main()
