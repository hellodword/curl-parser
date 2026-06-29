# curlparse ABI v1

The v1 ABI uses an engine handle for all parser and generator calls. Hosts pass
UTF-8 JSON through guest memory and receive an output `{ptr,len}` pair.

```c
uint32_t curlparse_abi_version(void);
uint32_t curlparse_alloc(uint32_t size);
void curlparse_free(uint32_t ptr, uint32_t size);
void curlparse_buf_free(uint32_t ptr, uint32_t size);
uint32_t curlparse_engine_new(void);
void curlparse_engine_free(uint32_t engine);
int32_t curlparse_parse_json(uint32_t engine, uint32_t input_ptr, uint32_t input_len, uint32_t out_pair_ptr);
int32_t curlparse_generate_json(uint32_t engine, uint32_t input_ptr, uint32_t input_len, uint32_t out_pair_ptr);
```

Parse failures are represented in output JSON. ABI return codes are reserved for
host/guest memory, engine, and invocation failures.
