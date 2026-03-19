import VPK from "vpk";
import fs from "fs";
import path from "path";
import * as parser from "@node-steam/vdf";
import { hashFileSync } from "hasha";
import { logger } from "../logger.js";
import type { Config } from "../config.js";

const TEXT_FILES = [
  "resource/csgo_brazilian.txt",
  "resource/csgo_bulgarian.txt",
  "resource/csgo_czech.txt",
  "resource/csgo_danish.txt",
  "resource/csgo_dutch.txt",
  "resource/csgo_english.txt",
  "resource/csgo_finnish.txt",
  "resource/csgo_french.txt",
  "resource/csgo_german.txt",
  "resource/csgo_greek.txt",
  "resource/csgo_hungarian.txt",
  "resource/csgo_italian.txt",
  "resource/csgo_japanese.txt",
  "resource/csgo_koreana.txt",
  "resource/csgo_latam.txt",
  "resource/csgo_norwegian.txt",
  "resource/csgo_polish.txt",
  "resource/csgo_portuguese.txt",
  "resource/csgo_romanian.txt",
  "resource/csgo_russian.txt",
  "resource/csgo_schinese.txt",
  "resource/csgo_schinese_pw.txt",
  "resource/csgo_spanish.txt",
  "resource/csgo_swedish.txt",
  "resource/csgo_tchinese.txt",
  "resource/csgo_thai.txt",
  "resource/csgo_turkish.txt",
  "resource/csgo_ukrainian.txt",
  "resource/csgo_vietnamese.txt",
  "scripts/items/items_game.txt",
];

function trimBOM(buffer: Buffer): Buffer {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3);
  }
  return buffer;
}

export async function downloadVPKDir(
  user: any,
  manifest: any,
  config: Config,
  vpkDir: string
): Promise<any> {
  const dirFile = manifest.manifest.files.find((f: any) =>
    f.filename.endsWith("csgo\\pak01_dir.vpk")
  );

  if (!dirFile) throw new Error("pak01_dir.vpk not found in manifest");

  const dirPath = path.join(vpkDir, "pak01_dir.vpk");
  logger.info("Downloading VPK directory file...");

  await user.downloadFile(config.depot.app_id, config.depot.id, dirFile, dirPath);

  const vpk = new VPK(dirPath);
  vpk.load();
  return vpk;
}

export function getTextFileArchiveIndices(vpk: any): number[] {
  const indices = new Set<number>();
  for (const fileName of vpk.files) {
    for (const txtFile of TEXT_FILES) {
      if (fileName === txtFile || fileName.startsWith(txtFile)) {
        indices.add(vpk.tree[fileName].archiveIndex);
        break;
      }
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

export function getAllArchiveIndices(vpk: any): number[] {
  const indices = new Set<number>();
  for (const fileName of vpk.files) {
    indices.add(vpk.tree[fileName].archiveIndex);
  }
  return Array.from(indices).sort((a, b) => a - b);
}

export async function downloadArchive(
  user: any,
  manifest: any,
  config: Config,
  archiveIndex: number,
  vpkDir: string,
  checksums: Record<string, string>,
  verifyChecksums: boolean
): Promise<boolean> {
  const padded = archiveIndex.toString().padStart(3, "0");
  const fileName = `pak01_${padded}.vpk`;
  const filePath = path.join(vpkDir, fileName);

  const file = manifest.manifest.files.find((f: any) => f.filename.endsWith(fileName));
  if (!file) {
    logger.warn(`${fileName} not found in manifest`);
    return false;
  }

  if (fs.existsSync(filePath)) {
    const cached = checksums[fileName];
    if (cached && cached === file.sha_content && !verifyChecksums) {
      logger.debug(`${fileName} cached (checksum match)`);
      return true;
    }
    try {
      const hash = hashFileSync(filePath, { algorithm: "sha1" });
      if (hash === file.sha_content) {
        checksums[fileName] = hash;
        logger.debug(`${fileName} verified on disk`);
        return true;
      }
    } catch {
      // will re-download
    }
  }

  logger.info(`Downloading ${fileName}...`);
  let retries = 3;
  while (retries > 0) {
    try {
      await user.downloadFile(config.depot.app_id, config.depot.id, file, filePath);
      checksums[fileName] = file.sha_content;
      return true;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      logger.warn(`Retry ${fileName} (${retries} left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

export async function downloadArchivesParallel(
  user: any,
  manifest: any,
  config: Config,
  indices: number[],
  vpkDir: string,
  checksums: Record<string, string>,
  verifyChecksums: boolean
): Promise<void> {
  const concurrency = config.download.parallel_archives;
  logger.info(`Downloading ${indices.length} VPK archives (concurrency: ${concurrency})`);

  const queue = [...indices];
  const active = new Set<Promise<void>>();

  while (queue.length > 0 || active.size > 0) {
    while (active.size < concurrency && queue.length > 0) {
      const idx = queue.shift()!;
      const p = downloadArchive(user, manifest, config, idx, vpkDir, checksums, verifyChecksums)
        .then(() => { active.delete(p); })
        .catch((err) => {
          logger.error(`Failed archive ${idx}:`, err);
          active.delete(p);
        });
      active.add(p);
    }
    if (active.size > 0) {
      await Promise.race(active);
    }
  }

  logger.success(`All ${indices.length} archives downloaded`);
}

export function extractTextFiles(vpk: any, outputDir: string): void {
  logger.info("Extracting text files from VPK...");
  fs.mkdirSync(outputDir, { recursive: true });
  let count = 0;

  for (const txtFile of TEXT_FILES) {
    for (const filePath of vpk.files) {
      if (filePath === txtFile || filePath.startsWith(txtFile)) {
        try {
          let buf = vpk.getFile(filePath);
          buf = trimBOM(buf);
          const parsed = parser.parse(buf.toString("utf-8"));

          const relDir = path.dirname(txtFile);
          const baseName = path.basename(txtFile, ".txt");
          const outDir = path.join(outputDir, relDir);
          fs.mkdirSync(outDir, { recursive: true });

          const jsonPath = path.join(outDir, `${baseName}.json`);
          fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
          count++;
          break;
        } catch (err) {
          logger.warn(`Could not extract ${txtFile}: ${(err as Error).message}`);
        }
      }
    }
  }

  logger.success(`Extracted ${count} text files`);
}
