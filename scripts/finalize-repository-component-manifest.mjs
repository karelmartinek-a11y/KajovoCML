import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryCatalogVersion = "1.1";
const componentCatalogVersion = "2026.07.22-compliance.1";
const sourceManifestSchemaPath = path.join(root, `apps/server/src/contracts/repository-component-source-manifest-${repositoryCatalogVersion}.schema.json`);
const componentManifestSchemaPath = path.join(root, `apps/server/src/contracts/component-manifest-${componentCatalogVersion}.schema.json`);
const receiptSchemaPath = path.join(root, "apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json");
const repositoryCatalogPath = path.join(root, `docs/onboarding-catalogs/repository-component-${repositoryCatalogVersion}.json`);

function parseArgs(argv) {
  const args = { repositoryKey: null, sourceManifest: null, receipt: null, output: null };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repository-key") args.repositoryKey = argv[++index] ?? null;
    else if (token === "--source-manifest") args.sourceManifest = argv[++index] ?? null;
    else if (token === "--receipt") args.receipt = argv[++index] ?? null;
    else if (token === "--output") args.output = argv[++index] ?? null;
    else throw new Error(`unsupported argument: ${token}`);
  }
  if (!args.repositoryKey || !args.sourceManifest || !args.receipt) {
    throw new Error("required arguments: --repository-key, --source-manifest, --receipt");
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateSchema(name, schemaPath, value) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  const validate = ajv.compile(readJson(schemaPath));
  if (!validate(value)) {
    throw new Error(`${name}_validation_failed:${JSON.stringify(validate.errors)}`);
  }
}

export function finalizeRepositoryComponentManifest({ repositoryKey, sourceManifest, receipt }) {
  const catalog = readJson(repositoryCatalogPath);
  const digestPattern = new RegExp(catalog.sourceManifest.finalization ? "^sha256:[a-f0-9]{64}$" : "^$");
  if (receipt.repositoryKey !== repositoryKey) throw new Error("receipt_repository_key_mismatch");
  if (sourceManifest.artifact?.type !== "OCI_IMAGE") throw new Error("unsupported_source_artifact_type");
  if (receipt.runtimeKind !== "UDS") throw new Error("unsupported_runtime_kind");
  if (!digestPattern.test(String(receipt.imageDigest ?? ""))) throw new Error("invalid_receipt_image_digest");
  if (!String(receipt.imageReference ?? "").includes(`/${repositoryKey}@`)) throw new Error("receipt_image_reference_mismatch");
  if (receipt.workflow !== ".github/workflows/repository-component-deploy.yml") throw new Error("unexpected_receipt_workflow");

  return {
    ...sourceManifest,
    artifact: {
      type: "OCI_IMAGE",
      digest: receipt.imageDigest,
      provenance: {
        ...sourceManifest.artifact.provenance,
        deployReceiptSchema: "apps/server/src/contracts/repository-component-deploy-receipt-1.0.schema.json",
        deployRunId: receipt.deployRunId,
        buildRunId: receipt.buildRunId
      },
      imageReference: receipt.imageReference
    },
    runtime: {
      ...sourceManifest.runtime,
      transport: "UDS",
      runtimeDigest: receipt.imageDigest,
      socketPath: receipt.runtimeLocation
    }
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv);
  const sourceManifest = readJson(path.resolve(root, args.sourceManifest));
  const receipt = readJson(path.resolve(root, args.receipt));
  validateSchema("source_manifest", sourceManifestSchemaPath, sourceManifest);
  validateSchema("deploy_receipt", receiptSchemaPath, receipt);
  const finalized = finalizeRepositoryComponentManifest({ repositoryKey: args.repositoryKey, sourceManifest, receipt });
  validateSchema("final_component_manifest", componentManifestSchemaPath, finalized);
  const rendered = `${JSON.stringify(finalized, null, 2)}\n`;
  if (args.output) {
    const target = path.resolve(root, args.output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, rendered);
  } else {
    process.stdout.write(rendered);
  }
}
