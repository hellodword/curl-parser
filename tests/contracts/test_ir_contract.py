#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
NATIVE_CLI = REPO_ROOT / "build" / "native" / "curlparse_cli"


def parse(argv: list[str], *, env: dict[str, str] | None = None) -> dict[str, Any]:
    payload = {
        "schemaVersion": "curl-parse-input/v1",
        "inputMode": "argv",
        "argv": argv,
    }
    run_env = os.environ.copy()
    if env:
        run_env.update(env)
    completed = subprocess.run(
        [str(NATIVE_CLI)],
        cwd=REPO_ROOT,
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
        env=run_env,
    )
    return json.loads(completed.stdout)


def body_kind(argv: list[str]) -> str:
    output = parse(argv)
    return output["ir"]["groups"][0]["transfers"][0]["effective"]["body"]["kind"]


def external_refs(argv: list[str]) -> list[dict[str, Any]]:
    output = parse(argv)
    return output["ir"]["externalRefs"]


def method(argv: list[str]) -> dict[str, Any]:
    output = parse(argv)
    return output["ir"]["groups"][0]["transfers"][0]["effective"]["method"]


def assert_external_refs_resolve(output: dict[str, Any]) -> None:
    refs = {item["id"] for item in output["ir"]["externalRefs"]}
    found: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            ref_id = value.get("externalRefId")
            if isinstance(ref_id, str):
                found.append(ref_id)
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(output["ir"])
    for ref_id in found:
        assert ref_id in refs, ref_id


def main() -> int:
    single = parse(["curl", "https://example.com"])
    assert len(single["ir"]["groups"]) == 1
    assert len(single["ir"]["groups"][0]["transfers"]) == 1
    assert single["ir"]["groups"][0]["transfers"][0]["effective"]["method"]["value"] == "GET"

    implicit = parse(["curl", "example.com"])
    implicit_transfer = implicit["ir"]["groups"][0]["transfers"][0]
    assert implicit_transfer["url"] == "http://example.com"
    assert implicit_transfer["rawUrl"] == "example.com"
    assert implicit_transfer["urlResolution"]["source"] == "curl-default"

    prefix = parse(["curl", "ftp.example.com/README"])
    prefix_transfer = prefix["ir"]["groups"][0]["transfers"][0]
    assert prefix_transfer["url"] == "ftp://ftp.example.com/README"
    assert prefix_transfer["urlResolution"]["source"] == "hostname-prefix"

    proto_default = parse(["curl", "--proto-default", "https", "example.com"])
    proto_default_transfer = proto_default["ir"]["groups"][0]["transfers"][0]
    assert proto_default_transfer["url"] == "https://example.com"
    assert proto_default_transfer["urlResolution"]["source"] == "proto-default"

    multi = parse(["curl", "https://a.example", "https://b.example"])
    assert len(multi["ir"]["groups"][0]["transfers"]) == 2

    next_groups = parse(["curl", "https://a.example", "--next", "https://b.example"])
    assert len(next_groups["ir"]["groups"]) == 2
    assert next_groups["ir"]["groups"][0]["transfers"][0]["url"] == "https://a.example"
    assert next_groups["ir"]["groups"][1]["transfers"][0]["url"] == "https://b.example"

    headers = parse([
        "curl",
        "-H",
        "A: one",
        "-H",
        "A: two",
        "https://example.com",
    ])
    ir_headers = headers["ir"]["groups"][0]["transfers"][0]["effective"]["headers"]
    assert [item["value"] for item in ir_headers] == ["one", "two"]

    assert body_kind(["curl", "--data", "a=1", "https://example.com"]) == "data"
    assert body_kind(["curl", "--data-raw", "@literal", "https://example.com"]) == "data-raw"
    assert body_kind(["curl", "--data-binary", "0101", "https://example.com"]) == "data-binary"
    assert body_kind(["curl", "--json", "{\"a\":1}", "https://example.com"]) == "json"
    assert body_kind(["curl", "--form", "a=b", "https://example.com"]) == "form"
    assert body_kind(["curl", "--form-string", "a=b", "https://example.com"]) == "form-string"

    assert method(["curl", "-I", "https://example.com"])["value"] == "HEAD"
    assert method(["curl", "-X", "PATCH", "https://example.com"])["value"] == "PATCH"
    post = method(["curl", "--data", "a=1", "https://example.com"])
    assert post["value"] == "POST"
    assert post["source"] == "body"
    json_post = method(["curl", "--json", "{\"a\":1}", "https://example.com"])
    assert json_post["value"] == "POST"
    assert json_post["source"] == "body"

    external_ref_cases = [
        (["curl", "--data-binary", "@secret.txt", "https://example.com"], "file", "secret.txt"),
        (["curl", "--json", "@-", "https://example.com"], "stdin", "-"),
        (["curl", "-F", "file=@secret.txt", "https://example.com"], "file", "secret.txt"),
        (["curl", "-F", "field=<secret.txt", "https://example.com"], "file", "secret.txt"),
        (["curl", "-H", "@headers.txt", "https://example.com"], "file", "headers.txt"),
        (["curl", "--upload-file", "secret.txt", "https://example.com"], "file", "secret.txt"),
        (["curl", "--cookie", "secret.txt", "https://example.com"], "file", "secret.txt"),
        (["curl", "--netrc", "https://example.com"], "netrc", None),
    ]
    for argv, kind, name in external_ref_cases:
        output = parse(argv)
        refs = output["ir"]["externalRefs"]
        assert refs, argv
        assert refs[0]["kind"] == kind
        if name is None:
            assert refs[0].get("value") is None
        else:
            assert refs[0]["value"] == name
        assert_external_refs_resolve(output)

    preflight = parse(["curl", "--data", "@payload", "--config", "curl.conf", "https://example.com"])
    assert preflight["ok"] is False
    assert any(error["code"] == "E_PARSE_HOST_DEPENDENCY_UNSUPPORTED" for error in preflight["errors"])
    assert preflight["ir"]["groups"][0]["transfers"][0]["effective"]["body"]["externalRefId"] == "external-0"

    assert external_refs(["curl", "--data-urlencode", "@payload.txt", "https://example.com"])[0]["option"] == "--data-urlencode"
    assert external_refs(["curl", "--data-urlencode", "name@payload.txt", "https://example.com"])[0]["option"] == "--data-urlencode"
    for literal in ["user=a@b.com", "=a@b.com", "name=@literal"]:
        output = parse(["curl", "--data-urlencode", literal, "https://example.com"])
        assert output["ir"]["externalRefs"] == []
        assert output["ir"]["groups"][0]["transfers"][0]["effective"]["body"]["value"] == literal

    assert external_refs(["curl", "--url-query", "@query.txt", "https://example.com"])[0]["option"] == "--url-query"
    assert external_refs(["curl", "--url-query", "name@query.txt", "https://example.com"])[0]["option"] == "--url-query"
    assert external_refs(["curl", "--url-query", "name=a@b.com", "https://example.com"]) == []

    cookie_output = parse(["curl", "-b", "cookies.txt", "https://example.com"])
    assert cookie_output["ir"]["groups"][0]["transfers"][0]["effective"]["cookies"][0]["externalRefId"] == "external-0"

    assert parse(["curl", "-z", "Wed, 21 Oct 2015 07:28:00 GMT", "https://example.com"])["ok"] is True
    time_file = parse(["curl", "-z", "stamp.txt", "https://example.com"])
    assert time_file["ok"] is False
    assert any(error["code"] == "E_HOST_FILE_MTIME_UNSUPPORTED" for error in time_file["errors"])

    host_env = {
        "CURL_CA_BUNDLE": "SHOULD_NOT_APPEAR_CA",
        "https_proxy": "SHOULD_NOT_APPEAR_PROXY",
        "HOME": "SHOULD_NOT_APPEAR_HOME",
        "NETRC": "SHOULD_NOT_APPEAR_NETRC",
        "IPFS_PATH": "SHOULD_NOT_APPEAR_IPFS",
        "SSLKEYLOGFILE": "SHOULD_NOT_APPEAR_SSLKEYLOG",
    }
    isolated = json.dumps(parse(["curl", "https://example.com"], env=host_env), sort_keys=True)
    for marker in host_env.values():
        assert marker not in isolated

    print("ir contract ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
