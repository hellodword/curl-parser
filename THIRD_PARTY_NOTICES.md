# Third-Party Notices

## curl

This project uses selected source code from the curl project as a local build
input under `third_party/curl/curl-8_20_0/`.

- Upstream project: <https://github.com/curl/curl>
- Upstream tag: `curl-8_20_0`
- Upstream license: MIT-like (`COPYING` in the vendored source tree)

The curl source tree is downloaded by `python scripts/tasks.py bootstrap` and is
not tracked in this git repository. The generated local manifest records copied
files and SHA-256 checksums for audit and release reproduction.
