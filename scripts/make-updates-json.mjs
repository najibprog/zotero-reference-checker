// Writes updates.json, the file Zotero checks (via update_url) to offer new versions.
// Usage: node scripts/make-updates-json.mjs <path-to-xpi>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const xpi = process.argv[2] || "zotero-reference-checker.xpi";
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { id, strict_min_version, strict_max_version } = manifest.applications.zotero;
const repo = manifest.homepage_url.replace(/^https:\/\/github\.com\//, "");
const hash = createHash("sha256").update(readFileSync(xpi)).digest("hex");

const updates = {
  addons: {
    [id]: {
      updates: [
        {
          version: manifest.version,
          update_link: `https://github.com/${repo}/releases/download/v${manifest.version}/zotero-reference-checker.xpi`,
          update_hash: `sha256:${hash}`,
          applications: { zotero: { strict_min_version, strict_max_version } },
        },
      ],
    },
  },
};
writeFileSync("updates.json", JSON.stringify(updates, null, 2) + "\n");
console.log(`updates.json written for ${id} ${manifest.version}`);
