import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { GET } = jiti("./healthz/route.ts");

test("health endpoint identifies ompweb without exposing workspace state", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: "ompweb", ok: true });
});
