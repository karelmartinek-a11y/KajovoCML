import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  REPOSITORY_COMPONENT_CATALOG_PATH,
  REPOSITORY_COMPONENT_CATALOG_VERSION,
  REPOSITORY_COMPONENT_SOURCE_MANIFEST_SCHEMA_PATH
} from "./repository-component-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const componentCatalogVersion = "2026.07.22-compliance.1";
const repositoryCatalogPath = path.join(root, REPOSITORY_COMPONENT_CATALOG_PATH);
const sourceManifestSchemaPath = path.join(root, REPOSITORY_COMPONENT_SOURCE_MANIFEST_SCHEMA_PATH);
const finalManifestSchemaPath = path.join(root, `apps/server/src/contracts/component-manifest-${componentCatalogVersion}.schema.json`);

const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const secretPattern = /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|github_pat_|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|kci_[A-Za-z0-9_-]{40,}|(?:password|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_+/=.-]{16,}|postgres(?:ql)?:\/\/|jdbc:postgresql:/i;
const dockerfilePattern = /(^|\/)Dockerfile(?:\.[^/]+)?$/;
const databasePackages = new Set(["pg", "postgres", "postgresql", "mysql", "mysql2", "mariadb", "better-sqlite3", "sqlite3", "knex", "typeorm", "prisma", "@prisma/client", "drizzle-orm", "sequelize", "mongodb", "mongoose"]);
const generatedDirectoryNames = new Set(["node_modules", "dist", "coverage", ".tmp", "tmp", ".cache", "build"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function compile(schema) {
  return new Ajv2020({ strict: true, allErrors: true, validateFormats: false }).compile(schema);
}

function relativeFrom(base, target) {
  return path.relative(base, target).replaceAll(path.sep, "/");
}

function parseArgs(argv) {
  const args = { repositoryKey: null, rootDir: root };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--repository-key") args.repositoryKey = argv[++index] ?? null;
    else if (token === "--root") args.rootDir = path.resolve(argv[++index] ?? "");
    else throw new Error(`unsupported argument: ${token}`);
  }
  return args;
}

function loadContracts(rootDir) {
  const catalog = readJson(path.join(rootDir, path.relative(root, repositoryCatalogPath)));
  return {
    catalog,
    componentsRoot: path.join(rootDir, catalog.repository.sourceRoot),
    descriptorValidate: compile(catalog.componentDescriptor.schema),
    sourceManifestValidate: compile(readJson(path.join(rootDir, path.relative(root, sourceManifestSchemaPath)))),
    finalManifestValidate: compile(readJson(path.join(rootDir, path.relative(root, finalManifestSchemaPath))))
  };
}

function componentDirectories(componentsRoot) {
  if (!fs.existsSync(componentsRoot)) return [];
  return fs.readdirSync(componentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function hasRequiredTest(srcDir) {
  if (!fs.existsSync(srcDir)) return false;
  const stack = [srcDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && /\.(?:test|spec)\.ts$/.test(entry.name)) return true;
    }
  }
  return false;
}

function detectManifestPhase(manifest) {
  const artifact = manifest?.artifact ?? {};
  const runtime = manifest?.runtime ?? {};
  return artifact.digest || artifact.imageReference || runtime.runtimeDigest || runtime.socketPath || runtime.upstream
    ? "final"
    : "source";
}

function parseText(buffer) {
  return buffer.includes(0) ? null : buffer.toString("utf8");
}

function isIgnoredDirectory(entryName) {
  return generatedDirectoryNames.has(entryName);
}

function resolveImport(fileDir, specifier) {
  if (specifier.startsWith(".")) return path.resolve(fileDir, specifier);
  if (specifier.startsWith("/")) return path.resolve(specifier);
  if (specifier.startsWith("components/")) return path.resolve(root, specifier);
  if (specifier.startsWith("apps/")) return path.resolve(root, specifier);
  return null;
}

function importSpecifiers(text) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function longRunningRuntime(manifest) {
  return manifest?.runtime?.executionMode === "LONG_RUNNING";
}

function hasNamedExport(sourceText, exportName) {
  return new RegExp(`export\\s+async\\s+function\\s+${exportName}\\s*\\(`).test(sourceText)
    || new RegExp(`export\\s+function\\s+${exportName}\\s*\\(`).test(sourceText);
}

export function validateRepositoryComponents({ rootDir = root, repositoryKey = null } = {}) {
  const { catalog, componentsRoot, descriptorValidate, sourceManifestValidate, finalManifestValidate } = loadContracts(rootDir);
  const failures = [];
  const repositoryKeyPattern = new RegExp(catalog.componentDescriptor.schema.properties.repositoryKey.pattern);
  const selectedKeys = componentDirectories(componentsRoot).filter((key) => !repositoryKey || key === repositoryKey);

  if (repositoryKey && selectedKeys.length === 0) {
    return [`${repositoryKey}: component directory not found`];
  }

  for (const key of selectedKeys) {
    const dir = path.join(componentsRoot, key);
    if (!repositoryKeyPattern.test(key)) failures.push(`${key}: invalid repository key`);
    const mustExist = catalog.requiredFiles.filter((item) => !item.includes("**"));
    for (const relative of mustExist) {
      if (!fs.existsSync(path.join(dir, relative))) failures.push(`${key}: missing ${relative}`);
    }
    if (!hasRequiredTest(path.join(dir, "src"))) failures.push(`${key}: missing recursive src test`);

    let descriptor = null;
    try {
      descriptor = readJson(path.join(dir, "component.kcml.json"));
    } catch {
      failures.push(`${key}: invalid component.kcml.json`);
    }
    if (descriptor) {
      if (!descriptorValidate(descriptor)) failures.push(`${key}: descriptor schema failed ${JSON.stringify(descriptorValidate.errors)}`);
      if (descriptor.repositoryKey !== key) failures.push(`${key}: repositoryKey mismatch`);
      if (!catalog.supportedKinds.includes(descriptor.kind)) failures.push(`${key}: unsupported component kind ${descriptor.kind}`);
    }

    let manifest = null;
    try {
      manifest = readJson(path.join(dir, "manifest.kcml.json"));
    } catch {
      failures.push(`${key}: invalid manifest.kcml.json`);
    }
    if (manifest) {
      const phase = detectManifestPhase(manifest);
      if (phase === "source") {
        if (!sourceManifestValidate(manifest)) failures.push(`${key}: source manifest schema failed ${JSON.stringify(sourceManifestValidate.errors)}`);
      } else if (!finalManifestValidate(manifest)) {
        failures.push(`${key}: final manifest schema failed ${JSON.stringify(finalManifestValidate.errors)}`);
      }
      if (longRunningRuntime(manifest)) {
        const indexPath = path.join(dir, "src/index.ts");
        const indexText = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
        if (!hasNamedExport(indexText, "start")) failures.push(`${key}: LONG_RUNNING component missing export start(context)`);
        if (!hasNamedExport(indexText, "stop")) failures.push(`${key}: LONG_RUNNING component missing export stop(context)`);
      }
    }

    let pkg = null;
    try {
      pkg = readJson(path.join(dir, "package.json"));
    } catch {
      failures.push(`${key}: invalid package.json`);
    }
    if (pkg) {
      if (pkg.type !== catalog.packagePolicy.moduleType || !String(pkg.engines?.node ?? "").includes(String(catalog.packagePolicy.nodeMajor))) {
        failures.push(`${key}: Node.js ${catalog.packagePolicy.nodeMajor} ESM required`);
      }
      for (const script of catalog.packagePolicy.requiredScripts) {
        if (typeof pkg.scripts?.[script] !== "string") failures.push(`${key}: missing script ${script}`);
      }
      for (const script of catalog.packagePolicy.forbiddenLifecycleScripts) {
        if (pkg.scripts?.[script]) failures.push(`${key}: forbidden script ${script}`);
      }
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        if (typeof version !== "string" || !exactVersion.test(version)) failures.push(`${key}: dependency ${name} must use exact version`);
        if (!catalog.packagePolicy.allowedRuntimeDependencies.includes(name)) failures.push(`${key}: runtime dependency not allowed ${name}`);
        if (databasePackages.has(name)) failures.push(`${key}: direct database dependency forbidden ${name}`);
      }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
        if (typeof version !== "string" || !exactVersion.test(version)) failures.push(`${key}: devDependency ${name} must use exact version`);
        if (!catalog.packagePolicy.allowedDevelopmentDependencies.includes(name)) failures.push(`${key}: development dependency not allowed ${name}`);
      }
    }

    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        const relative = relativeFrom(dir, absolute);
        if (entry.name.startsWith("._") || entry.name === ".DS_Store") continue;
        if (entry.isSymbolicLink()) {
          failures.push(`${key}: symlink forbidden ${relative}`);
          continue;
        }
        if (entry.isDirectory()) {
          if (isIgnoredDirectory(entry.name)) continue;
          stack.push(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        if (dockerfilePattern.test(relative)) failures.push(`${key}: custom Dockerfile forbidden ${relative}`);

        const stat = fs.statSync(absolute);
        const content = fs.readFileSync(absolute);
        const text = parseText(content);

        if (text === null) {
          if ((stat.mode & 0o111) !== 0) failures.push(`${key}: binary executable forbidden ${relative}`);
          continue;
        }

        if (relative !== "pnpm-lock.yaml" && secretPattern.test(text)) failures.push(`${key}: secret-like material in ${relative}`);

        for (const specifier of importSpecifiers(text)) {
          if (specifier.startsWith("apps/")) failures.push(`${key}: import from apps/ forbidden in ${relative}: ${specifier}`);
          if (databasePackages.has(specifier)) failures.push(`${key}: direct database import forbidden in ${relative}: ${specifier}`);
          const resolved = resolveImport(path.dirname(absolute), specifier);
          if (!resolved) continue;
          const normalized = path.normalize(resolved);
          if (normalized.startsWith(componentsRoot + path.sep) && !normalized.startsWith(dir + path.sep) && normalized !== dir) {
            failures.push(`${key}: cross-component import forbidden in ${relative}: ${specifier}`);
          }
          if (normalized.startsWith(path.join(rootDir, "apps") + path.sep)) {
            failures.push(`${key}: private apps import forbidden in ${relative}: ${specifier}`);
          }
        }
      }
    }
  }

  return failures;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv);
  const failures = validateRepositoryComponents({ rootDir: args.rootDir, repositoryKey: args.repositoryKey });
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    const scope = args.repositoryKey ? ` (${args.repositoryKey})` : "";
    console.log(`validated repository components${scope}`);
  }
}
