import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { implementGeneration } from "./openai-responses.js";

describe("generation implementation artifact acceptance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the Responses tool-loop open until every final artifact validates", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "kcml-implementation-validation-"));
    try {
      await mkdir(path.join(workspace, "elements", "fixture"), { recursive: true });
      await writeFile(path.join(workspace, "component-manifest.schema.json"), JSON.stringify({
        type: "object",
        required: ["valid"],
        additionalProperties: false,
        properties: { valid: { const: true } }
      }));
      await writeFile(path.join(workspace, "elements", "fixture", "manifest.kcml.json"), JSON.stringify({ valid: false }));
      await writeFile(path.join(workspace, "elements", "fixture", "handler.mjs"), "export const tools = [];\nexport async function invoke() { return {}; }\n");
      const result = {
        summary: "fixture",
        elements: [{ key: "fixture", handlerPath: "elements/fixture/handler.mjs", manifestPath: "elements/fixture/manifest.kcml.json" }],
        integrationPlan: { required: false, summary: "", steps: [] }
      };
      const requests: Array<Record<string, unknown>> = [];
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
        if (typeof init?.body !== "string") throw new Error("request_body_missing");
        const body = JSON.parse(init.body) as Record<string, unknown>;
        requests.push(body);
        if (requests.length === 2) await writeFile(path.join(workspace, "elements", "fixture", "manifest.kcml.json"), JSON.stringify({ valid: true }));
        return new Response(JSON.stringify({ id: `response-${requests.length}`, output_text: JSON.stringify(result), output: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }));

      await expect(implementGeneration("fixture-key", "fixture-model", {
        prompt: "fixture",
        plan: { understoodIntent: "fixture", resultSummary: "fixture", elements: [], dependencies: [], missingInputs: [] },
        reservations: [],
        workspace,
        sourceRoot: workspace,
        chromiumBinary: "/not-used",
        secretPresent: async () => false,
        resolveSecret: async () => { throw new Error("not_used"); }
      })).resolves.toEqual(result);

      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({ previous_response_id: "response-1" });
      expect(String(requests[1]?.input)).toContain("FINAL_CANDIDATE_VALIDATION_FAILED");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
