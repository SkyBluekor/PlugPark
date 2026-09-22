from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def run(cmd: list[str], cwd: Path) -> None:
    print("> " + " ".join(cmd))
    completed = subprocess.run(cmd, cwd=cwd)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    project = Path.cwd()
    worker = project / "worker" / "index.ts"
    package = project / "package.json"

    if not worker.exists():
        raise SystemExit(f"worker/index.ts를 찾지 못했습니다: {worker}")

    source = worker.read_text(encoding="utf-8")

    fixed = "      statusFresh: null as boolean | null,\n"
    old = "      statusFresh: null,\n"

    if fixed in source:
        print("v0.7.0.1 type hotfix가 이미 적용되어 있습니다.")
    else:
        context = """    charger: {
      total: Number(row.charger_total || 0),"""
        pos = source.find(context)
        if pos < 0:
            raise SystemExit(
                "예상한 v0.7.0 readRowToPlace 구조를 찾지 못했습니다. "
                "현재 소스가 다른 버전일 수 있으므로 아무것도 수정하지 않았습니다."
            )
        status_pos = source.find(old, pos)
        if status_pos < 0 or status_pos - pos > 2500:
            raise SystemExit(
                "readRowToPlace의 statusFresh: null 위치를 찾지 못했습니다. "
                "아무것도 수정하지 않았습니다."
            )

        backup_dir = project / ".plugpark" / "recovery-backup-v0.7.0.1"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(worker, backup_dir / f"worker-index-{stamp}.ts")

        source = source[:status_pos] + fixed + source[status_pos + len(old):]

        source = source.replace(
            "const CACHE_VERSION = 'v7.0.0';",
            "const CACHE_VERSION = 'v7.0.1';",
            1,
        )
        source = source.replace(
            "const DATA_LAYER_VERSION = 'v0.7.0';",
            "const DATA_LAYER_VERSION = 'v0.7.0.1';",
            1,
        )
        worker.write_text(source, encoding="utf-8")
        print("PASS · worker/index.ts statusFresh 타입을 boolean | null로 확장")
        print(f"backup · {backup_dir}")

        if package.exists():
            import json
            data = json.loads(package.read_text(encoding="utf-8"))
            if data.get("version") == "0.7.0":
                data["version"] = "0.7.0-1"
                package.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                print("PASS · package version 0.7.0-1")

    if args.verify:
        print("\n로컬 LIVE 검증을 다시 실행합니다.")
        print("원칙: remote Cloudflare write 0 · 실제 공공 API call 0")
        run(["npm", "run", "verify:live-local"], project)


if __name__ == "__main__":
    main()
