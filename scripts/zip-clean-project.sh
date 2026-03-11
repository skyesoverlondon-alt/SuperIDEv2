#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_NAME="${1:-SuperIDEv2.zip}"
OUTPUT_PATH="$ROOT_DIR/$OUTPUT_NAME"

cd "$ROOT_DIR"
rm -f "$OUTPUT_PATH"

python3 - <<'PY' "$ROOT_DIR" "$OUTPUT_PATH"
import os
import subprocess
import sys
import zipfile

root_dir, output_path = sys.argv[1], sys.argv[2]

raw = subprocess.check_output(
    ["git", "-C", root_dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
)
paths = [p for p in raw.decode("utf-8", errors="surrogateescape").split("\0") if p]

excluded_prefixes = (
    "SKNore/",
    "DEVV ONLY NO GIT/",
    "zzzz/",
)
excluded_exact = {
    "SKNore.env",
}

def keep(path: str) -> bool:
    normalized = path.replace("\\", "/")
    if normalized.endswith(".zip"):
      return False
    if normalized in excluded_exact:
      return False
    if normalized.startswith(excluded_prefixes):
      return False
    return True

filtered = sorted({p for p in paths if keep(p) and os.path.isfile(os.path.join(root_dir, p))})

with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for rel_path in filtered:
        archive.write(os.path.join(root_dir, rel_path), arcname=rel_path)

print(f"Created {output_path} with {len(filtered)} files")
PY
