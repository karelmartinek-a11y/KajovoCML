#!/usr/bin/env node
import assert from "node:assert/strict";
import { automaticRepairAuthority, GENERATION_EXECUTION_AUTHORITY_MATRIX } from "../apps/server/src/domain/generation.ts";

assert.deepEqual(automaticRepairAuthority(true), { state: "IMPLEMENTING", blockerCode: null });
assert.deepEqual(automaticRepairAuthority(false), { state: "BLOCKED", blockerCode: "generation_repair_spec_lineage_missing" });
assert.deepEqual(GENERATION_EXECUTION_AUTHORITY_MATRIX.map(({ path }) => path), ["CREATE", "OWNER_FOLLOW_UP", "TECHNICAL_RETRY", "AUTOMATIC_REPAIR", "REMEDIATION"]);
assert.equal(GENERATION_EXECUTION_AUTHORITY_MATRIX.find(({ path }) => path === "CREATE")?.approvalRequired, true);
assert.equal(GENERATION_EXECUTION_AUTHORITY_MATRIX.find(({ path }) => path === "TECHNICAL_RETRY")?.semanticChange, false);
assert.equal(GENERATION_EXECUTION_AUTHORITY_MATRIX.find(({ path }) => path === "AUTOMATIC_REPAIR")?.authorityKind, "INHERITED_TECHNICAL");
assert.equal(GENERATION_EXECUTION_AUTHORITY_MATRIX.find(({ path }) => path === "REMEDIATION")?.sourceSpecification, "same job frozen authority lineage");
console.log("PASS automatic repair requires inherited approved specification authority");
