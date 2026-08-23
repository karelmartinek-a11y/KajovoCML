import assert from "node:assert/strict";
import fs from "node:fs";

const matrix = fs.readFileSync("docs/qa/SSOT_INTEGRATION_MATRIX.md", "utf8");
const ledger = fs.readFileSync("docs/qa/SSOT_COMPLIANCE_LEDGER.md", "utf8");
const rows = [...matrix.matchAll(/^\|\s*(\d+)\s*\|[^\n]*\|\s*(PASS|FAIL|NOT VERIFIED)\s*\|/gmu)].map((match) => ({ id: Number(match[1]), status: match[2] }));
assert.equal(rows.length, 160, `expected 160 matrix rows, got ${rows.length}`);
assert.deepEqual([...new Set(rows.map((row) => row.id))].sort((a, b) => a - b), Array.from({ length: 160 }, (_, index) => index + 1));
assert.match(ledger, /Exactly one human role is `OWNER`/u);
assert.match(ledger, /Database accepts only `OWNER`/u);
assert.match(ledger, /API cannot create a human role choice/u);
assert.match(ledger, /UI exposes no human role selector/u);
assert.match(ledger, /Machine principals remain independent/u);
const counts = rows.reduce((result, row) => ({ ...result, [row.status]: (result[row.status] ?? 0) + 1 }), {});
process.stdout.write(`SSOT compliance ledger: matrix=160 PASS=${counts.PASS ?? 0} FAIL=${counts.FAIL ?? 0} NOT_VERIFIED=${counts["NOT VERIFIED"] ?? 0}\n`);
