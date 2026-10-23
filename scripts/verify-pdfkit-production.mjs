import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";

const packagePath = new URL("../node_modules/pdfkit/package.json", import.meta.url);
const tracePath = new URL("../.next/server/app/api/chat/route.js.nft.json", import.meta.url);
const pdfkitPackage = JSON.parse(await readFile(packagePath, "utf8"));
const trace = JSON.parse(await readFile(tracePath, "utf8"));

assert.equal(pdfkitPackage.version, "0.20.2", "Unexpected PDFKit version in the qualified installation.");
assert.ok(pdfkitPackage.imports?.["#standard-fonts/*"], "PDFKit standard-font import mapping is missing.");
assert.ok(
  trace.files.some((file) => file.endsWith("node_modules/pdfkit/js/pdfkit.node.mjs")),
  "The production chat route does not trace the external PDFKit runtime.",
);
assert.ok(
  trace.files.some((file) => file.endsWith("node_modules/pdfkit/js/standard-fonts/Helvetica.cjs")),
  "The production chat route does not package PDFKit's standard Helvetica font module.",
);

const bytes = await new Promise((resolve, reject) => {
  const document = new PDFDocument();
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  document.once("error", reject);
  document.once("end", () => resolve(Buffer.concat(chunks)));
  document.text("Production package standard-font smoke test.");
  document.end();
});

assert.ok(bytes.byteLength > 100, "PDFKit returned an unexpectedly small PDF.");
assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "PDFKit did not return valid PDF bytes.");
console.log(`PDFKit ${pdfkitPackage.version} production trace and Helvetica PDF render passed (${bytes.byteLength} bytes).`);
