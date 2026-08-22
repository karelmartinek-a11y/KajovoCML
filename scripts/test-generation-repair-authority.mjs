#!/usr/bin/env node
import assert from "node:assert/strict";
import { automaticRepairAuthority } from "../apps/server/src/domain/generation.ts";

assert.deepEqual(automaticRepairAuthority(true), { state: "IMPLEMENTING", blockerCode: null });
assert.deepEqual(automaticRepairAuthority(false), { state: "BLOCKED", blockerCode: "generation_repair_spec_lineage_missing" });
console.log("PASS automatic repair requires inherited approved specification authority");
