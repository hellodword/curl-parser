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


def log_request(request):
    print(f"> {request.method} {request.url}", file=sys.stderr)


def log_response(response):
    print(f"< {response.status_code} {response.reason_phrase}", file=sys.stderr)


def main():
    with httpx.Client(event_hooks={"request": [log_request], "response": [log_response]}) as session:
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
