import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

let removed = 0;

async function cleanDirectory(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith("._") || entry.name === ".DS_Store") {
      await rm(path, { force: true, recursive: true });
      removed += 1;
    } else if (entry.isDirectory()) {
      await cleanDirectory(path);
    }
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push(".");

for (const root of roots) await cleanDirectory(root);
process.stdout.write(`appledouble-cleanup:OK removed=${removed}\n`);
