import fs from "fs";
import path from "path";
import { logger } from "../logger.js";

export function readManifestId(manifestFile: string): string {
  try {
    return fs.readFileSync(manifestFile, "utf-8").trim();
  } catch {
    return "";
  }
}

export function writeManifestId(manifestFile: string, id: string): void {
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, id);
}

export function needsUpdate(manifestFile: string, latestId: string, force: boolean): boolean {
  if (force) {
    logger.info("Force download enabled, skipping manifest check");
    return true;
  }
  const existing = readManifestId(manifestFile);
  if (existing === latestId) {
    logger.info("Already at latest manifest, no update needed");
    return false;
  }
  return true;
}

export function loadChecksums(file: string): Record<string, string> {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {
    logger.warn("Could not load checksums, will re-verify");
  }
  return {};
}

export function saveChecksums(file: string, checksums: Record<string, string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(checksums, null, 2));
  logger.debug(`Saved checksums for ${Object.keys(checksums).length} files`);
}
