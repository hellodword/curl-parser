#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "config" / "curl-source.json"
NOTICE_PATH = REPO_ROOT / "THIRD_PARTY_NOTICES.md"


def main() -> int:
    source = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    tag = source["tag"]
    commit = source["upstreamCommit"]
    license_file = source["licenseFile"]
    text = f"""# Third-Party Notices

## curl

This project uses selected source code from the curl project as a local build
input under `third_party/curl/{tag}/`.

- Upstream project: <https://github.com/curl/curl>
- Upstream tag: `{tag}`
- Upstream commit: `{commit}`
- Upstream license: MIT-like (`{license_file}` in the vendored source tree)

The curl source tree is downloaded by
`nix develop --command python scripts/tasks.py bootstrap` and is not tracked in this
git repository. The generated local manifest records copied files and SHA-256
checksums for audit and release reproduction.
"""
    NOTICE_PATH.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
