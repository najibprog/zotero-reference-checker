// Sets the version in manifest.json, e.g. `node scripts/set-version.mjs 1.3.1` (a leading "v" is ignored)
import { readFileSync, writeFileSync } from "node:fs";

const version = (process.argv[2] || "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?$/.test(version)) {
  console.error(`Invalid version "${process.argv[2] || ""}" (expected e.g. 1.3.1)`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json version set to ${version}`);
