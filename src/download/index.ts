import fs from "fs";
import path from "path";
import { logger } from "../logger.js";
import type { Config } from "../config.js";
import { createSteamClient, loginToSteam, getLatestManifest, getManifest } from "./steam.js";
import { needsUpdate, writeManifestId, loadChecksums, saveChecksums } from "./cache.js";
import {
  downloadVPKDir,
  getTextFileArchiveIndices,
  getAllArchiveIndices,
  downloadArchivesParallel,
  extractTextFiles,
} from "./vpk.js";

export interface DownloadResult {
  updated: boolean;
  manifestId: string;
}

export async function downloadBase(config: Config): Promise<DownloadResult> {
  logger.step("Download: text files (items_game, languages)");

  const vpkDir = path.resolve(config.paths.data, "vpk");
  const outputDir = path.resolve(config.paths.data, "output");
  const manifestFile = path.resolve(config.paths.data, "manifests", "base_manifest.txt");
  fs.mkdirSync(vpkDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });

  const user = createSteamClient();
  await loginToSteam(user, config);

  const { latestManifestId } = await getLatestManifest(user, config);
  logger.info(`Latest manifest: ${latestManifestId}`);

  if (!needsUpdate(manifestFile, latestManifestId, config.download.force)) {
    user.logOff();
    return { updated: false, manifestId: latestManifestId };
  }

  const manifest = await getManifest(user, config, latestManifestId);
  const vpk = await downloadVPKDir(user, manifest, config, vpkDir);

  const indices = getTextFileArchiveIndices(vpk);
  await downloadArchivesParallel(user, manifest, config, indices, vpkDir, {}, false);

  extractTextFiles(vpk, outputDir);
  writeManifestId(manifestFile, latestManifestId);

  user.logOff();
  return { updated: true, manifestId: latestManifestId };
}

export async function downloadStatic(config: Config): Promise<DownloadResult> {
  logger.step("Download: all VPK archives (static assets)");

  const vpkDir = path.resolve(config.paths.data, "vpk");
  const manifestFile = path.resolve(config.paths.data, "manifests", "static_manifest.txt");
  const checksumFile = path.resolve(config.paths.data, "manifests", "static_checksums.json");
  fs.mkdirSync(vpkDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });

  const user = createSteamClient();
  await loginToSteam(user, config);

  const { latestManifestId } = await getLatestManifest(user, config);

  if (!needsUpdate(manifestFile, latestManifestId, config.download.force)) {
    user.logOff();
    return { updated: false, manifestId: latestManifestId };
  }

  const manifest = await getManifest(user, config, latestManifestId);
  const vpk = await downloadVPKDir(user, manifest, config, vpkDir);

  const indices = getAllArchiveIndices(vpk);
  const checksums = loadChecksums(checksumFile);

  await downloadArchivesParallel(
    user, manifest, config, indices, vpkDir,
    checksums, config.download.verify_checksums
  );

  saveChecksums(checksumFile, checksums);
  writeManifestId(manifestFile, latestManifestId);

  user.logOff();
  return { updated: true, manifestId: latestManifestId };
}

export async function download(config: Config): Promise<DownloadResult> {
  const baseResult = await downloadBase(config);
  if (baseResult.updated) {
    const staticResult = await downloadStatic(config);
    return staticResult;
  }
  return baseResult;
}
