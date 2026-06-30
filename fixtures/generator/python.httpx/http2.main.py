from http.cookiejar import MozillaCookieJar
from pathlib import Path
import sys

import httpx


def load_cookie_jar(path):
    jar = MozillaCookieJar()
    jar.load(path, ignore_discard=True, ignore_expires=True)
    return jar


def parse_header_lines(text):
    headers = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, separator, value = line.partition(":")
        if separator and name:
            headers[name] = value.lstrip()
    return headers


def main():
    with httpx.Client(http2=True) as session:
        url = "https://example.com"
        headers = {}
        request_kwargs = {
            "headers": headers,
        }
        request_kwargs["follow_redirects"] = False
        response = session.request("GET", url, **request_kwargs)
        response.raise_for_status()
        print(response.text)

if __name__ == "__main__":
    main()
