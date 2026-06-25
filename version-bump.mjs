import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.argv[2]?.replace(/^v/, "");

if (!targetVersion) {
  console.error("Usage: node version-bump.mjs <version>");
  process.exit(1);
}

// read minAppVersion from manifest.json and bump version to targetVersion
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// update versions.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
