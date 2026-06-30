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
    with httpx.Client(proxy="http://user:pass@proxy.example:8080", max_redirects=3) as session:
        url = "https://example.com"
        headers = {}
        request_kwargs = {
            "headers": headers,
        }
        request_kwargs["timeout"] = httpx.Timeout(5, connect=2)
        request_kwargs["follow_redirects"] = True
        response = session.request("GET", url, **request_kwargs)
        response.raise_for_status()
        print(response.text)

if __name__ == "__main__":
    main()
