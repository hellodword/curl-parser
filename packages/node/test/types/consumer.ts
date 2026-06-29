import {
  createParser,
  listTargets,
  parseCurl,
  type CurlParser,
  type ParseOutput,
  type Target,
} from "@hellodword/curl-parser";
import { createParser as createBrowserParser } from "@hellodword/curl-parser/browser";
import { schemaCatalog } from "@hellodword/curl-parser/schemas";

const target: Target = listTargets()[0] ?? "js.fetch";
const schemaId: string = schemaCatalog.curlIrV1.id;

async function useParser(parser: CurlParser): Promise<ParseOutput> {
  return parser.parseCurl(["curl", "https://example.com"]);
}

async function main(): Promise<void> {
  const parser = await createParser();
  try {
    await useParser(parser);
    await parseCurl("curl https://example.com", { shellDialect: "posix-sh" });
  } finally {
    parser.dispose();
  }

  await createBrowserParser({
    wasmBytes: new Uint8Array(),
    imports: {},
  }).catch(() => undefined);

  void target;
  void schemaId;
}

void main;
