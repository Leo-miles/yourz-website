import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = process.argv[2] || "app";
const app = fs.readFileSync(`${root}/public/app.js`, "utf8");
const handler = fs.readFileSync(`${root}/src/handler.js`, "utf8");
const marker = "/* YOURZ_SUPPLIER_MULTIPART_UPLOAD_V1 */";
assert.ok(app.includes(marker), "supplier multipart UI patch is installed");
assert.ok(handler.includes(marker), "supplier multipart worker patch is installed");

const start = app.indexOf("async function uploadSupplierQuoteFiles(id,files,category){");
const end = app.indexOf("\n function guide(){", start);
assert.ok(start >= 0 && end > start, "supplier upload function boundaries exist");
const implementation = app.slice(start, end);

function makeHarness({ failPartOnce = null, failPartAlways = null, failComplete = false } = {}) {
  const calls = { starts: [], parts: [], completions: [], deletes: [], reloads: [], toasts: [] };
  let failures = new Map();
  const context = {
    stale: false, busy: false, session: { csrf: "test-csrf" },
    canEdit: () => true,
    get: (id) => id === "supplier-42" ? { id, status: "active" } : null,
    productExt: (name) => name.split(".").pop().toLowerCase(),
    document: { getElementById: () => ({ textContent: "" }) },
    fetch: async (url, options = {}) => {
      if (url.startsWith("/api/files/multipart?")) {
        calls.starts.push({ url, options });
        return { ok: true, status: 200, json: async () => ({ uploadId: `upload-${calls.starts.length}` }) };
      }
      const part = Number(new URL(url, "https://test.invalid").searchParams.get("partNumber"));
      if (url.includes("/part?")) {
        calls.parts.push({ url, options, part });
        const count = (failures.get(part) || 0) + 1; failures.set(part, count);
        if ((failPartOnce === part && count === 1) || failPartAlways === part) {
          return { ok: false, status: 503, json: async () => ({ error: "simulated temporary R2 failure" }) };
        }
        return { ok: true, status: 200, json: async () => ({ etag: `etag-${part}` }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
    api: async (url, options = {}) => {
      if (url.endsWith("/complete")) {
        calls.completions.push({ url, options });
        if (failComplete) throw new Error("simulated completion interruption");
        return { ok: true };
      }
      if (options.method === "DELETE") { calls.deletes.push({ url, options }); return { ok: true }; }
      throw new Error(`Unexpected api ${url}`);
    },
    loadSupplierQuoteFiles: async (...args) => calls.reloads.push(args),
    toast: (message) => calls.toasts.push(message),
    console,
  };
  vm.createContext(context);
  vm.runInContext(implementation, context, { timeout: 1000 });
  return { calls, upload: context.uploadSupplierQuoteFiles };
}

const bigFile = { name: "supplier-quote.pdf", size: 21 * 1024 * 1024, slice: (a, b) => ({ size: b - a }) };
{
  const { calls, upload } = makeHarness({ failPartOnce: 2 });
  await upload("supplier-42", [bigFile], "quote");
  assert.equal(calls.starts.length, 1, "large supplier file starts one multipart session");
  const startUrl = new URL(calls.starts[0].url, "https://test.invalid");
  assert.equal(startUrl.searchParams.get("supplierId"), "supplier-42");
  assert.equal(startUrl.searchParams.get("category"), "quote");
  assert.equal(calls.parts.length, 3, "21 MiB file is split into two parts and failed part is retried");
  assert.deepEqual(calls.completions[0].options.body.parts.map(p => [p.partNumber, p.etag]), [[1,"etag-1"],[2,"etag-2"]]);
  assert.equal(calls.deletes.length, 0, "completed upload is not aborted");
}
{
  const { calls, upload } = makeHarness({ failPartAlways: 1 });
  await upload("supplier-42", [bigFile], "image");
  assert.equal(calls.parts.length, 3, "failed part receives three attempts");
  assert.equal(calls.completions.length, 0, "incomplete upload is never finalized");
  assert.equal(calls.deletes.length, 1, "interrupted multipart session is cleaned up");
  assert.match(calls.deletes[0].url, /upload-1$/);
}
{
  const { calls, upload } = makeHarness({ failComplete: true });
  await upload("supplier-42", [bigFile], "quote");
  assert.equal(calls.completions.length, 1, "completion is attempted after all parts succeed");
  assert.equal(calls.deletes.length, 1, "completion interruption triggers cleanup");
}

// Guard server-side behavior that cannot be executed without Cloudflare's Worker bindings.
assert.match(handler, /MAX_TOTAL_PRODUCT_FILE_BYTES\s*=\s*20_000_000_000/);
assert.match(handler, /MAX_TOTAL_PRODUCT_FILE_BYTES/);
assert.match(handler, /supplier_id,file_category/);
assert.match(handler, /supplierId:supplierId\|\|"",fileCategory:category/);
assert.match(handler, /supplier_id:row\.supplier_id\|\|null,file_category:row\.file_category\|\|"general"/);
assert.match(handler, /file_upload_reservations/);
assert.match(handler, /resumeMultipartUpload\([^)]*\)\.abort\(\)/);
console.log("PASS: simulated 21 MiB supplier multipart success, part retry, interrupted-upload cleanup, completion cleanup, supplier/category association, and 20 GB quota guards.");
console.log("NOTE: Worker D1/R2 bindings and real Cloudflare R2 remain unverified; quota and server association assertions are source guards, not live-binding integration tests.");
