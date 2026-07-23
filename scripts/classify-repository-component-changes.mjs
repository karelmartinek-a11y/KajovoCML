import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "docs/onboarding-catalogs/repository-component-1.0.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const repositoryKeyPattern = new RegExp(catalog.componentDescriptor.schema.properties.repositoryKey.pattern);

function parseNameStatusZ(buffer) {
  const tokens = buffer.toString("utf8").split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++] ?? "";
    if (!status) continue;
    if (/^[RC]\d+$/.test(status)) {
      entries.push({ status, paths: [tokens[index++] ?? "", tokens[index++] ?? ""] });
      continue;
    }
    entries.push({ status, paths: [tokens[index++] ?? ""] });
  }
  return entries;
}

function componentPathDetails(changedPath) {
  if (changedPath === "components/README.md" || changedPath === "components/AGENTS.md") {
    return { kind: "component_infrastructure", path: changedPath };
  }
  const match = /^components\/([^/]+)\/(.+)$/.exec(changedPath);
  if (!match) {
    return changedPath.startsWith("components/")
      ? { kind: "invalid_component_path", path: changedPath }
      : { kind: "platform_path", path: changedPath };
  }
  const repositoryKey = match[1];
  if (!repositoryKeyPattern.test(repositoryKey)) {
    return { kind: "invalid_component_path", path: changedPath, repositoryKey };
  }
  return { kind: "component_path", path: changedPath, repositoryKey };
}

export function classifyChangedEntries(entries) {
  const componentKeys = new Set();
  const componentPaths = [];
  const platformPaths = [];
  const componentInfrastructurePaths = [];
  const invalidPaths = [];
  const deletedComponentKeys = new Set();

  for (const entry of entries) {
    for (const changedPath of entry.paths) {
      const details = componentPathDetails(changedPath);
      if (details.kind === "component_path") {
        componentKeys.add(details.repositoryKey);
        componentPaths.push(changedPath);
        if (/^D/.test(entry.status)) deletedComponentKeys.add(details.repositoryKey);
      } else if (details.kind === "component_infrastructure") {
        componentInfrastructurePaths.push(changedPath);
      } else if (details.kind === "invalid_component_path") {
        invalidPaths.push(changedPath);
      } else {
        platformPaths.push(changedPath);
      }
    }
  }

  const repositoryKeys = [...componentKeys].sort();
  const hasComponentChange = repositoryKeys.length > 0;
  const pureComponentChange = hasComponentChange
    && repositoryKeys.length === 1
    && platformPaths.length === 0
    && componentInfrastructurePaths.length === 0
    && invalidPaths.length === 0;
  const mixedChange = hasComponentChange && !pureComponentChange;

  return {
    changedPathCount: entries.reduce((count, entry) => count + entry.paths.length, 0),
    hasChanges: entries.length > 0,
    hasComponentChange,
    repositoryKeys,
    repositoryKeyCount: repositoryKeys.length,
    selectedRepositoryKey: repositoryKeys.length === 1 ? repositoryKeys[0] : null,
    pureComponentChange,
    mixedChange,
    componentInfrastructureOnly: !hasComponentChange && componentInfrastructurePaths.length > 0 && platformPaths.length === 0 && invalidPaths.length === 0,
    multipleComponents: repositoryKeys.length > 1,
    componentPaths,
    platformPaths,
    componentInfrastructurePaths,
    invalidPaths,
    deletedComponentKeys: [...deletedComponentKeys].sort()
  };
}

function parseCliArgs(argv) {
  const args = { stdin: false, base: null, head: null };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--stdin") args.stdin = true;
    else if (token === "--base") args.base = argv[++index] ?? null;
    else if (token === "--head") args.head = argv[++index] ?? null;
    else throw new Error(`unsupported argument: ${token}`);
  }
  if (args.stdin === (Boolean(args.base) || Boolean(args.head))) {
    throw new Error("use either --stdin or --base/--head");
  }
  if (!args.stdin && (!args.base || !args.head)) {
    throw new Error("both --base and --head are required");
  }
  return args;
}

function readEntries(args) {
  if (args.stdin) {
    return parseNameStatusZ(fs.readFileSync(0));
  }
  const output = execFileSync("git", ["diff", "--name-status", "-z", args.base, args.head], {
    cwd: root,
    encoding: "buffer"
  });
  return parseNameStatusZ(output);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv);
  const entries = readEntries(args);
  process.stdout.write(`${JSON.stringify(classifyChangedEntries(entries), null, 2)}\n`);
}
