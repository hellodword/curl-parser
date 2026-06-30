from http.cookiejar import MozillaCookieJar
from pathlib import Path
import sys

import requests


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
    session = requests.Session()
    url = "https://example.com"
    headers = {}
    request_kwargs = {
        "headers": headers,
    }
    request_kwargs["verify"] = "ca.pem"
    request_kwargs["cert"] = ("client.pem", "client.key")
    request_kwargs["allow_redirects"] = False
    response = session.request("GET", url, **request_kwargs)
    response.raise_for_status()
    print(response.text)

if __name__ == "__main__":
    main()
