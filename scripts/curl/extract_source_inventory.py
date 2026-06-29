#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path


CURATED_TOOL_SOURCES = [
    "src/tool_getparam.c",
    "src/tool_cfgable.c",
    "src/tool_paramhlp.c",
    "src/tool_parsecfg.c",
    "src/tool_formparse.c",
    "src/tool_helpers.c",
    "src/tool_msgs.c",
    "src/tool_util.c",
    "src/tool_findfile.c",
    "src/tool_filetime.c",
    "src/tool_urlglob.c",
    "src/slist_wc.c",
    "src/var.c",
]

CURATED_CURLX_SOURCES = [
    "lib/curlx/base64.c",
    "lib/curlx/basename.c",
    "lib/curlx/dynbuf.c",
    "lib/curlx/fopen.c",
    "lib/curlx/strcopy.c",
    "lib/curlx/strdup.c",
    "lib/curlx/strerr.c",
    "lib/curlx/strparse.c",
    "lib/curlx/timediff.c",
    "lib/curlx/timeval.c",
    "lib/curlx/warnless.c",
]

OWNED_SOURCES = [
    "core/c/src/api/curlparse_api.c",
    "core/c/src/api/curlparse_core.c",
    "core/c/src/api/curlparse_json.c",
    "core/c/src/api/curlparse_result.c",
    "core/c/src/api/curlparse_stubs.c",
    "core/c/src/runtime/curlparse_profile.c",
    "core/c/src/runtime/curlparse_libinfo.c",
    "core/c/src/runtime/curlparse_option_guard.c",
    "core/c/src/capture/curlparse_event_scan.c",
    "core/c/src/capture/curlparse_serialize_config.c",
    "core/c/src/io/curlparse_external_refs.c",
]


def parse_makefile_variable(lines: list[str], variable_name: str) -> list[str]:
    items: list[str] = []
    collecting = False

    for raw_line in lines:
        line = raw_line.rstrip("\n")
        if not collecting:
            prefix = f"{variable_name} ="
            if not line.startswith(prefix):
                continue
            payload = line[len(prefix) :].strip()
            collecting = True
        else:
            payload = line.strip()

        payload = payload.split("#", 1)[0].rstrip()
        continued = payload.endswith("\\")
        if continued:
            payload = payload[:-1].rstrip()

        if payload:
            for token in payload.split():
                if token.startswith("$("):
                    continue
                items.append(token)

        if collecting and not continued:
            break

    if not items:
        raise ValueError(f"failed to parse {variable_name} from Makefile.inc")
    return items


def normalize_curlx_path(path: str) -> str:
    if path.startswith("../"):
        return path[3:]
    return path


def source_version_from_tag(tag: str) -> str:
    if not tag.startswith("curl-"):
        raise ValueError(f"unexpected curl tag format: {tag}")
    return tag[len("curl-") :].replace("_", ".")


def validate_subset(required: list[str], available: set[str], label: str) -> None:
    missing = [path for path in required if path not in available]
    if missing:
        joined = ", ".join(missing)
        raise ValueError(f"{label} missing from upstream inventory: {joined}")


def validate_owned_sources(workspace_root: Path) -> None:
    missing = [path for path in OWNED_SOURCES if not (workspace_root / path).is_file()]
    if missing:
        joined = ", ".join(missing)
        raise FileNotFoundError(f"owned sources missing from workspace: {joined}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--curl-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--rsp", required=True)
    args = parser.parse_args()

    workspace_root = Path(__file__).resolve().parents[2]
    curl_root = (workspace_root / args.curl_root).resolve()
    makefile_path = curl_root / "src/Makefile.inc"
    lines = makefile_path.read_text(encoding="utf-8").splitlines()

    curl_cfiles = {
        f"src/{entry}"
        for entry in parse_makefile_variable(lines, "CURL_CFILES")
        if entry.endswith(".c")
    }
    curlx_cfiles = {
        normalize_curlx_path(entry)
        for entry in parse_makefile_variable(lines, "CURLX_CFILES")
        if entry.endswith(".c")
    }

    validate_subset(CURATED_TOOL_SOURCES, curl_cfiles, "tool sources")
    validate_subset(CURATED_CURLX_SOURCES, curlx_cfiles, "curlx sources")
    validate_owned_sources(workspace_root)

    tag = curl_root.name
    inventory = {
        "curlSourceVersion": source_version_from_tag(tag),
        "curlToolSources": CURATED_TOOL_SOURCES,
        "curlxSources": CURATED_CURLX_SOURCES,
        "ownedSources": OWNED_SOURCES,
    }

    out_path = (workspace_root / args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")

    rsp_lines = []
    rsp_lines.extend(OWNED_SOURCES)
    rsp_lines.extend(f"{args.curl_root}/{path}" for path in CURATED_TOOL_SOURCES)
    rsp_lines.extend(f"{args.curl_root}/{path}" for path in CURATED_CURLX_SOURCES)

    rsp_path = (workspace_root / args.rsp).resolve()
    rsp_path.parent.mkdir(parents=True, exist_ok=True)
    rsp_path.write_text("\n".join(rsp_lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
