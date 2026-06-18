from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def load_parser_class():
    try:
        from curl_parser_wasm import CurlParserWasm
    except ImportError:
        venv_python = Path(__file__).resolve().parents[2] / ".venv" / "bin" / "python"
        if venv_python.exists() and Path(sys.executable) != venv_python:
            completed = subprocess.run(
                [str(venv_python), str(Path(__file__).resolve())],
                check=False,
            )
            raise SystemExit(completed.returncode)
        raise

    return CurlParserWasm


def main() -> None:
    CurlParserWasm = load_parser_class()
    parser = CurlParserWasm(
        Path(__file__).resolve().parents[2] / "dist" / "curl_parser.wasm"
    )

    result = parser.parse(
        {
            "schemaVersion": "1.0",
            "inputMode": "argv",
            "argv": [
                "curl",
                "--http3",
                "--json",
                "{\"a\":1}",
                "https://example.com",
            ],
            "parseMode": "strict",
            "runtimeProfile": {
                "curlVersion": "8.20.0",
                "protocols": [
                    "dict",
                    "file",
                    "ftp",
                    "ftps",
                    "gopher",
                    "gophers",
                    "http",
                    "https",
                    "imap",
                    "imaps",
                    "ipfs",
                    "ipns",
                    "mqtt",
                    "mqtts",
                    "pop3",
                    "pop3s",
                    "rtsp",
                    "scp",
                    "sftp",
                    "smtp",
                    "smtps",
                    "telnet",
                    "tftp",
                ],
                "features": [
                    "alt-svc",
                    "AsynchDNS",
                    "brotli",
                    "GSS-API",
                    "HSTS",
                    "HTTP2",
                    "HTTP3",
                    "HTTPS-proxy",
                    "IDN",
                    "IPv6",
                    "Kerberos",
                    "Largefile",
                    "libz",
                    "PSL",
                    "SPNEGO",
                    "SSL",
                    "threadsafe",
                    "TLS-SRP",
                    "UnixSockets",
                    "zstd",
                ],
                "compile": {
                    "availableOptions": None,
                    "disabledOptions": [],
                    "defines": [],
                },
            },
            "options": {
                "loadDefaultCurlrc": False,
                "allowHostFileRead": False,
                "virtualFiles": {},
            },
        }
    )

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
