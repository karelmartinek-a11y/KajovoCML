import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { KCML_RELEASE } from "./release.js";
import { validateComponentManifest } from "./component.js";
function readJson(path: string): Record<string, unknown> { return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>; }
const schema = readJson(`../contracts/component-manifest-${KCML_RELEASE.manifestSchemaVersion}.schema.json`);
const example = readJson(`../../../../docs/onboarding-manifest-${KCML_RELEASE.manifestSchemaVersion}.example.json`);
describe("canonical component manifest contract", () => {
 it("validates the canonical schema and example", () => { const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:false}); const validate=ajv.compile(schema as AnySchema); expect(validate(example), JSON.stringify(validate.errors)).toBe(true); expect(validateComponentManifest(example).kind).toBe("inventory-api"); });
 it("rejects platform-assigned identity fields", () => { expect(() => validateComponentManifest({...example,code:"KCML9999"})).toThrow("invalid_manifest"); });
});
