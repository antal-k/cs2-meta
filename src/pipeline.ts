import fs from "fs";
import path from "path";
import { logger } from "./logger.js";
import type { Config } from "./config.js";
import { download } from "./download/index.js";
import { extract } from "./extract/index.js";
import { extractThumbnails } from "./extract/thumbnails.js";
import { process as processItems } from "./process/index.js";

const LOCK_FILE = ".cs2-meta.lock";

function acquireLock(config: Config): boolean {
  const lockPath = path.resolve(config.paths.data, LOCK_FILE);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    const pid = fs.readFileSync(lockPath, "utf-8").trim();
    logger.error(`Pipeline already running (PID ${pid}). Remove ${lockPath} to force.`);
    return false;
  }

  fs.writeFileSync(lockPath, process.pid.toString());
  return true;
}

function releaseLock(config: Config): void {
  const lockPath = path.resolve(config.paths.data, LOCK_FILE);
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // already removed
  }
}

export interface PipelineOptions {
  force?: boolean;
  skipExtract?: boolean;
  skipProcess?: boolean;
  languages?: string[];
}

export async function runPipeline(config: Config, opts: PipelineOptions = {}): Promise<void> {
  if (!acquireLock(config)) return;

  try {
    logger.step("Pipeline: starting full run");
    const start = Date.now();

    if (opts.force) config.download.force = true;

    // Step 1: Download
    const downloadResult = await download(config);
    logger.info(`Download step: updated=${downloadResult.updated}, manifest=${downloadResult.manifestId}`);

    // Step 2: Extract (S2V handles incremental caching via --vpk_cache)
    if (!opts.skipExtract) {
      await extract(config);
    }

    // Step 3: Process
    if (!opts.skipProcess) {
      await processItems(config, opts.languages);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    logger.success(`Pipeline complete in ${elapsed}s`);
  } catch (err) {
    logger.error("Pipeline failed:", (err as Error).message);
    throw err;
  } finally {
    releaseLock(config);
  }
}
