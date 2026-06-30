# Generators

Generator implementations consume Curl IR and target capability data. The
target directories are staged here:

- `javascript`
- `python`
- `go`
- `rust`

Target capability manifests live in `capabilities/` and use
`schemas/target-capabilities.v2.schema.json`.

`docs/targets.md` is the public target capability document. Leaf generator
directories should keep implementation code only; do not duplicate target
coverage in per-generator README files.
