import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryCatalogVersion = "1.1";
const componentCatalogVersion = "2026.07.22-compliance.1";
const companionManifestSchemaPath = `apps/server/src/contracts/component-manifest-${componentCatalogVersion}.schema.json`;
const sourceManifestSchemaPath = `apps/server/src/contracts/repository-component-source-manifest-${repositoryCatalogVersion}.schema.json`;
const catalogOutputPath = path.join(root, `docs/onboarding-catalogs/repository-component-${repositoryCatalogVersion}.json`);
const schemaOutputPath = path.join(root, sourceManifestSchemaPath);

const shaDigestPattern = "^sha256:[a-f0-9]{64}$";
const repositoryKeyPattern = "^[a-z0-9][a-z0-9-]{2,62}$";
const objectSchema = { type: "object", minProperties: 1 };
const contentSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mediaType", "json"],
      properties: { mediaType: { const: "application/json" }, json: {} }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mediaType", "base64"],
      properties: { mediaType: { type: "string", minLength: 3 }, base64: { type: "string", minLength: 1, contentEncoding: "base64" } }
    }
  ]
};
const runtimeSecretGrantSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", pattern: "^[A-Z][A-Z0-9_]{2,127}$" },
    required: { type: "boolean", default: true }
  }
};
const runtimeEgressGrantSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "targetHost", "port", "pathPrefix", "scope"],
      properties: {
        type: { const: "HTTPS_FETCH" },
        targetHost: { type: "string", minLength: 3, maxLength: 255, pattern: "^[A-Za-z0-9.-]+$" },
        port: { type: "integer", minimum: 1, maximum: 65535 },
        pathPrefix: { type: "string", pattern: "^/" },
        scope: { type: "string", minLength: 2, maxLength: 160 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "targetHost", "port", "servername", "scope", "protocol"],
      properties: {
        type: { const: "TCP_TLS" },
        targetHost: { type: "string", minLength: 3, maxLength: 255, pattern: "^[A-Za-z0-9.-]+$" },
        port: { type: "integer", minimum: 1, maximum: 65535 },
        servername: { type: "string", minLength: 3, maxLength: 255, pattern: "^[A-Za-z0-9.-]+$" },
        scope: { type: "string", minLength: 2, maxLength: 160 },
        protocol: { const: "TCP_TLS" }
      }
    }
  ]
};

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sourceManifestSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://kajovocml.hcasc.cz/contracts/repository-component-source-manifest-${repositoryCatalogVersion}.schema.json`,
    title: "KajovoCML repository component source manifest",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "registrationRevision",
      "displayName",
      "businessPurpose",
      "kind",
      "owners",
      "contacts",
      "criticality",
      "artifact",
      "runtime",
      "capabilities",
      "tools",
      "endpoints",
      "pulses",
      "states",
      "controlPlane",
      "e2eScenarios",
      "documentationEvidence",
      "secretPolicy",
      "outboundPolicies",
      "monitoring",
      "auditPolicy"
    ],
    properties: {
      schemaVersion: { const: componentCatalogVersion },
      registrationRevision: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
      displayName: { type: "string", minLength: 2, maxLength: 200 },
      businessPurpose: { type: "string", minLength: 10, maxLength: 4000 },
      kind: { type: "string", minLength: 2, maxLength: 120 },
      owners: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 2 }, team: { type: "string" } }
        }
      },
      contacts: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["type", "value"],
          additionalProperties: false,
          properties: { type: { enum: ["EMAIL", "SLACK", "URL"] }, value: { type: "string", minLength: 3 } }
        }
      },
      criticality: {
        type: "object",
        required: ["level", "reviewIntervalDays"],
        additionalProperties: false,
        properties: {
          level: { enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          reviewIntervalDays: { type: "integer", minimum: 1, maximum: 365 }
        }
      },
      artifact: {
        type: "object",
        additionalProperties: false,
        required: ["type", "provenance", "buildContract"],
        properties: {
          type: { const: "OCI_IMAGE" },
          provenance: objectSchema,
          buildContract: {
            type: "object",
            additionalProperties: false,
            required: ["workflow", "registryPathTemplate", "finalizeWithReceipt"],
            properties: {
              workflow: { const: ".github/workflows/repository-component-deploy.yml" },
              registryPathTemplate: { const: "ghcr.io/<owner>/kajovocml-components/<repository-key>:<commit-sha>" },
              finalizeWithReceipt: { const: "apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json" }
            }
          }
        }
      },
      runtime: {
        type: "object",
        additionalProperties: false,
        required: ["transport", "executionMode", "resources", "lifecycle", "readinessMode", "persistentState", "secretGrants", "egressGrants"],
        properties: {
          transport: { const: "UDS" },
          executionMode: { enum: ["REQUEST_RESPONSE", "LONG_RUNNING"] },
          lifecycle: {
            type: "object",
            additionalProperties: false,
            required: ["prepareRequired", "gracefulShutdownSeconds", "singleActiveWorker"],
            properties: {
              prepareRequired: { type: "boolean" },
              gracefulShutdownSeconds: { type: "integer", minimum: 1, maximum: 600 },
              singleActiveWorker: { type: "boolean" }
            }
          },
          readinessMode: { const: "DEPENDENCY_AWARE" },
          persistentState: {
            type: "object",
            additionalProperties: false,
            required: ["required", "mountPath", "survivesRestart", "survivesUpgrade", "survivesRollback"],
            properties: {
              required: { type: "boolean" },
              mountPath: { type: "string", pattern: "^/" },
              survivesRestart: { const: true },
              survivesUpgrade: { const: true },
              survivesRollback: { const: true }
            }
          },
          secretGrants: { type: "array", items: runtimeSecretGrantSchema },
          egressGrants: { type: "array", items: runtimeEgressGrantSchema },
          resources: {
            type: "object",
            required: ["cpuMillis", "memoryMiB", "maxConcurrency"],
            additionalProperties: false,
            properties: {
              cpuMillis: { type: "integer", minimum: 10 },
              memoryMiB: { type: "integer", minimum: 16 },
              maxConcurrency: { type: "integer", minimum: 1 }
            }
          }
        }
      },
      capabilities: { type: "array", uniqueItems: true, items: { type: "string", minLength: 2, maxLength: 160 } },
      tools: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "title", "description", "inputSchema", "outputSchema", "scope", "timeoutMs", "limits"],
          additionalProperties: false,
          properties: {
            name: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
            title: { type: "string", minLength: 2 },
            description: { type: "string", minLength: 5 },
            inputSchema: objectSchema,
            outputSchema: objectSchema,
            scope: { type: "string", minLength: 2 },
            timeoutMs: { type: "integer", minimum: 100, maximum: 300000 },
            limits: {
              type: "object",
              required: ["requestMaxBytes", "responseMaxBytes"],
              additionalProperties: false,
              properties: {
                requestMaxBytes: { type: "integer", minimum: 1 },
                responseMaxBytes: { type: "integer", minimum: 1 }
              }
            },
            annotations: { type: "object" }
          }
        }
      },
      endpoints: {
        type: "array",
        items: {
          type: "object",
          required: ["key", "method", "path", "scope", "requestSchema", "responseSchema"],
          additionalProperties: false,
          properties: {
            key: { type: "string", minLength: 2 },
            method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string", pattern: "^/" },
            scope: { type: "string", minLength: 2 },
            requestSchema: objectSchema,
            responseSchema: objectSchema
          }
        }
      },
      pulses: {
        type: "object",
        required: ["incoming", "outgoing"],
        additionalProperties: false,
        properties: { incoming: { type: "array", items: { $ref: "#/$defs/pulse" } }, outgoing: { type: "array", items: { $ref: "#/$defs/pulse" } } }
      },
      states: {
        type: "object",
        required: ["states", "transitions"],
        additionalProperties: false,
        properties: {
          states: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["key", "category", "schema"],
              additionalProperties: false,
              properties: { key: { type: "string", minLength: 2 }, category: { type: "string", minLength: 2 }, schema: objectSchema, terminal: { type: "boolean" } }
            }
          },
          transitions: {
            type: "array",
            items: {
              type: "object",
              required: ["from", "to", "trigger"],
              additionalProperties: false,
              properties: { from: { type: "string" }, to: { type: "string" }, trigger: { type: "string" } }
            }
          }
        }
      },
      controlPlane: {
        type: "object",
        required: ["enable", "disable", "state", "heartbeat"],
        additionalProperties: false,
        properties: Object.fromEntries(["enable", "disable", "state", "heartbeat"].map((key) => [key, {
          type: "object",
          required: ["path", "requestSchema", "responseSchema"],
          additionalProperties: false,
          properties: { path: { type: "string", pattern: "^/" }, requestSchema: objectSchema, responseSchema: objectSchema }
        }]))
      },
      e2eScenarios: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["scenarioKey", "variantKey", "invocation", "input", "expected", "timeoutMs", "deterministic", "cleanup"],
          additionalProperties: false,
          properties: {
            scenarioKey: { type: "string", minLength: 2 },
            variantKey: { type: "string", minLength: 1 },
            invocation: {
              type: "object",
              required: ["kind", "name"],
              additionalProperties: false,
              properties: { kind: { enum: ["TOOL", "PULSE", "ENDPOINT"] }, name: { type: "string", minLength: 1 } }
            },
            input: contentSchema,
            expected: contentSchema,
            timeoutMs: { type: "integer", minimum: 100, maximum: 600000 },
            deterministic: { const: true },
            cleanup: {
              type: "object",
              required: ["required"],
              additionalProperties: false,
              properties: { required: { type: "boolean" }, operation: { type: "string" } }
            }
          }
        }
      },
      documentationEvidence: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["key", "path", "digest", "content"],
          additionalProperties: false,
          properties: {
            key: { type: "string", minLength: 2 },
            path: { type: "string", pattern: "^(?!/)(?!.*\\.\\.).+$" },
            digest: { type: "string", pattern: shaDigestPattern },
            content: contentSchema
          }
        }
      },
      secretPolicy: {
        type: "object",
        required: ["authorizationAuthority", "allSecretsRequireGrant", "auditLevel"],
        additionalProperties: false,
        properties: { authorizationAuthority: { const: "KCML" }, allSecretsRequireGrant: { const: true }, auditLevel: { const: "FULL" } }
      },
      outboundPolicies: {
        type: "array",
        items: runtimeEgressGrantSchema
      },
      monitoring: {
        type: "object",
        required: ["probes", "staleAfterSeconds", "disableAfterSeconds"],
        additionalProperties: false,
        properties: {
          probes: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["kind", "intervalSeconds"],
              additionalProperties: false,
              properties: { kind: { type: "string", minLength: 2 }, intervalSeconds: { type: "integer", minimum: 5 } }
            }
          },
          staleAfterSeconds: { type: "integer", minimum: 10 },
          disableAfterSeconds: { type: "integer", minimum: 10 }
        }
      },
      auditPolicy: {
        type: "object",
        required: ["technicalAudit", "payloadProtection", "retentionDays"],
        additionalProperties: false,
        properties: { technicalAudit: { const: "PLATFORM" }, payloadProtection: { const: "ENCRYPTED" }, retentionDays: { type: "integer", minimum: 1 } }
      }
    },
    $defs: {
      pulse: {
        type: "object",
        required: ["type", "schema", "scope"],
        additionalProperties: false,
        properties: { type: { type: "string", minLength: 2 }, schema: objectSchema, scope: { type: "string", minLength: 2 } }
      }
    }
  };
}

function repositoryCatalog() {
  return {
    version: repositoryCatalogVersion,
    serviceKind: "REPOSITORY_COMPONENT_SOURCE",
    status: "ACTIVE",
    maintenanceModes: ["EXTERNAL", "IN_REPOSITORY"],
    companionComponentCatalog: `component-${componentCatalogVersion}.json`,
    companionComponentManifestSchema: companionManifestSchemaPath,
    purpose: "Normative source-layout and delivery contract for AI agents, MCP-facing components and deterministic microsteps that may be maintained either outside KajovoCML or in components/<repository-key>/ inside the KajovoCML repository.",
    repository: {
      sourceRoot: "components",
      directoryPattern: "^components/[a-z0-9][a-z0-9-]{2,62}/$",
      inRepositoryLocationRule: "When a component is maintained in KajovoCML it must live exclusively in components/<repository-key>/.",
      externalMaintenanceRule: "A component may also be maintained outside KajovoCML and then follows only the generic component onboarding catalog at registration time.",
      identityRule: "The repository key is not a KCML identity. KCML assigns code and hostname during registration.",
      oneLogicalComponentPerDirectory: true,
      crossComponentSourceImportsForbidden: true,
      rootWorkspaceMembership: false,
      ignoredGeneratedDirectories: ["node_modules", "dist", "coverage", ".tmp", "tmp", ".cache", "build"]
    },
    supportedKinds: ["AI_AGENT", "MCP_COMPONENT", "MICROSTEP", "API_COMPONENT", "EVENT_PROCESSOR"],
    requiredFiles: [
      "component.kcml.json",
      "manifest.kcml.json",
      "README.md",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "src/index.ts",
      "src/**/*.test.ts|src/**/*.spec.ts",
      "evidence/architecture.md",
      "evidence/threat-model.md",
      "evidence/runbook.md"
    ],
    componentDescriptor: {
      file: "component.kcml.json",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["catalogVersion", "repositoryKey", "kind", "displayName", "businessPurpose", "owners", "runtime", "entrypoint", "maintenanceMode", "registration"],
        properties: {
          catalogVersion: { const: repositoryCatalogVersion },
          repositoryKey: { type: "string", pattern: repositoryKeyPattern },
          kind: { enum: ["AI_AGENT", "MCP_COMPONENT", "MICROSTEP", "API_COMPONENT", "EVENT_PROCESSOR"] },
          displayName: { type: "string", minLength: 2, maxLength: 200 },
          businessPurpose: { type: "string", minLength: 20, maxLength: 4000 },
          owners: {
            type: "object",
            required: ["service", "technical"],
            additionalProperties: false,
            properties: { service: { type: "string", minLength: 2 }, technical: { type: "string", minLength: 2 } }
          },
          runtime: { const: "nodejs24-typescript" },
          entrypoint: { const: "src/index.ts" },
          maintenanceMode: { enum: ["EXTERNAL", "IN_REPOSITORY"] },
          registration: {
            type: "object",
            additionalProperties: false,
            required: ["manifest", "intake", "identityAssignedBy"],
            properties: {
              manifest: { const: "manifest.kcml.json" },
              intake: { const: "/v2/component-onboardings" },
              identityAssignedBy: { const: "KCML" }
            }
          }
        }
      }
    },
    sourceManifest: {
      file: "manifest.kcml.json",
      schemaPath: sourceManifestSchemaPath,
      lifecycle: {
        sourcePhase: "Codex prepares the static registration contract in the source directory before build.",
        buildPhase: "The repository-component deploy workflow builds the immutable OCI image and signs SBOM and provenance.",
        deployPhase: "The deployment wrapper writes the nonsecret deploy receipt with the immutable image digest and stable live runtime location.",
        finalizationPhase: "The final manifest is synthesized from manifest.kcml.json plus the deploy receipt and only that finalized manifest is uploaded to /v2/component-onboardings."
      },
      finalization: {
        script: "scripts/finalize-repository-component-manifest.mjs",
        receiptSchema: "apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json",
        finalManifestSchema: companionManifestSchemaPath
      }
    },
    packagePolicy: {
      packageManager: "pnpm@11.7.0",
      nodeMajor: 24,
      moduleType: "module",
      exactDependencyVersions: true,
      requiredScripts: ["lint", "typecheck", "test", "build"],
      forbiddenLifecycleScripts: ["preinstall", "install", "postinstall", "prepare"],
      allowedRuntimeDependencies: ["@kcml/handler-sdk", "html-to-text", "imapflow", "mailparser", "zod"],
      allowedDevelopmentDependencies: ["@types/node", "eslint", "typescript", "vitest"]
    },
    sourceContract: {
      export: "async function invoke(input, context); LONG_RUNNING components must also export async function start(context) and async function stop(context).",
      network: "All outbound traffic must use the KCML egress capability.",
      secrets: "All secrets require an explicit KCML grant and must never be committed.",
      database: "Direct database access is forbidden unless represented by a separately authorized KCML capability.",
      deterministicAudit: "Every operation must expose input, process, output, success and correlation identifiers through the registered KCML contracts."
    },
    deliveryPipeline: {
      sourcePullRequest: {
        scope: "exactly one components/<repository-key>/ directory",
        requiredChecks: ["repository-catalog-check", "descriptor-schema", "manifest-schema", "lint", "typecheck", "unit-tests", "invoke-contract", "dependency-audit", "reproducible-build"]
      },
      build: {
        output: "immutable OCI image",
        registryPath: "ghcr.io/<owner>/kajovocml-components/<repository-key>:<commit-sha>",
        requirements: ["SBOM", "keyless signature", "SLSA-style provenance"]
      },
      deployment: {
        workflow: ".github/workflows/repository-component-deploy.yml",
        receiptSchema: "apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json",
        runtimeVerification: ["immutable digest", "health endpoint", "readiness endpoint", "state endpoint", "runtime identity", "stable live runtime location", "persistent data root", "previous runtime preservation"]
      },
      registration: {
        authorization: "short-lived integration token",
        intake: "/v2/component-onboardings",
        idempotencyHeader: "Idempotency-Key",
        readiness: "/v2/component-onboardings/{id}/readiness",
        revision: "/v2/component-onboardings/{id}/revisions",
        concurrencyControl: "ETag/If-Match",
        tokenConsumption: "after successful access-token handoff"
      }
    },
    separationOfAuthorities: {
      integrationTokenDoesNotAuthorize: ["GitHub write", "pull request merge", "deployment", "administrator activation", "secret access without grant"],
      sourceMergeIsNotRegistration: true,
      signedImageIsNotRegistration: true,
      registrationIsNotActivation: true
    },
    forbidden: [
      "components containing secrets",
      "client-supplied KCML identity",
      "cross-component source coupling",
      "placeholder evidence",
      "fake digests",
      "custom Dockerfile",
      "symlinks",
      "binary executables",
      "direct production configuration outside KCML GUI"
    ]
  };
}

const schema = sourceManifestSchema();
const catalog = repositoryCatalog();
const digestInput = structuredClone(catalog);
catalog.canonicalDigest = `sha256:${crypto.createHash("sha256").update(canonical(digestInput)).digest("hex")}`;

const outputs = [
  [catalogOutputPath, catalog],
  [schemaOutputPath, schema]
];

const check = process.argv.includes("--check");
let stale = false;
for (const [file, value] of outputs) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== rendered) {
      console.error(`stale generated artifact: ${path.relative(root, file)}`);
      stale = true;
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rendered);
  }
}
if (stale) process.exitCode = 1;
