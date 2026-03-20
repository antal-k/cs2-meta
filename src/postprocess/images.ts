import fs from "fs";
import path from "path";
import sharp from "sharp";
import { logger } from "../logger.js";
import type { Config, ImageSizeDef } from "../config.js";

interface ConvertStats {
  total: number;
  converted: number;
  skipped: number;
  failed: number;
}

interface ConvertJob {
  src: string;
  dest: string;
  format: "avif" | "webp";
  quality: number;
  width?: number;
}

async function findPngs(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findPngs(full)));
    } else if (entry.name.endsWith(".png")) {
      results.push(full);
    }
  }
  return results;
}

function needsConversion(src: string, dest: string, skipExisting: boolean): boolean {
  if (!skipExisting) return true;
  if (!fs.existsSync(dest)) return true;
  const srcStat = fs.statSync(src);
  const destStat = fs.statSync(dest);
  return srcStat.mtimeMs > destStat.mtimeMs;
}

function buildDest(src: string, format: string, sizeSuffix?: string): string {
  const ext = `.${format}`;
  if (sizeSuffix) {
    return src.replace(/\.png$/, `.${sizeSuffix}${ext}`);
  }
  return src.replace(/\.png$/, ext);
}

async function runJob(job: ConvertJob): Promise<"converted" | "skipped" | "failed"> {
  try {
    let pipeline = sharp(job.src);

    if (job.width) {
      const meta = await pipeline.metadata();
      if (meta.width && meta.width > job.width) {
        pipeline = pipeline.resize({ width: job.width, withoutEnlargement: true });
      }
    }

    if (job.format === "avif") {
      await pipeline.avif({ quality: job.quality, effort: 4 }).toFile(job.dest);
    } else {
      await pipeline.webp({ quality: job.quality, effort: 4 }).toFile(job.dest);
    }
    return "converted";
  } catch {
    return "failed";
  }
}

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

function buildJobs(
  pngs: string[],
  formats: ("avif" | "webp")[],
  quality: Record<string, number>,
  sizes: ImageSizeDef[],
  skipExisting: boolean,
): ConvertJob[] {
  const jobs: ConvertJob[] = [];

  for (const src of pngs) {
    for (const format of formats) {
      const q = quality[format];

      const fullDest = buildDest(src, format);
      if (needsConversion(src, fullDest, skipExisting)) {
        jobs.push({ src, dest: fullDest, format, quality: q });
      }

      for (const size of sizes) {
        const dest = buildDest(src, format, size.suffix);
        if (needsConversion(src, dest, skipExisting)) {
          jobs.push({ src, dest, format, quality: q, width: size.width });
        }
      }
    }
  }

  return jobs;
}

export async function convertImages(config: Config): Promise<void> {
  const postprocess = config.postprocess?.images;
  if (!postprocess?.enabled) {
    logger.info("Image post-processing is disabled, skipping");
    return;
  }

  const { formats, quality, sizes, concurrency, skip_existing } = postprocess;
  const outputDir = path.resolve(config.paths.output);

  const sizeLabels = sizes.map((s) => `${s.suffix}@${s.width}w`).join(", ");
  logger.step(
    `Post-process: PNGs → ${formats.join(" & ").toUpperCase()} | sizes: original, ${sizeLabels}`,
  );

  const scanSpinner = logger.spin("Scanning for PNG files...");
  const pngs = await findPngs(outputDir);
  scanSpinner.succeed(`Found ${pngs.length} PNG files`);

  if (pngs.length === 0) return;

  const jobs = buildJobs(pngs, formats, quality, sizes, skip_existing);
  const skippedCount = pngs.length * formats.length * (1 + sizes.length) - jobs.length;

  if (jobs.length === 0) {
    logger.success(`All ${skippedCount} outputs already up-to-date`);
    return;
  }

  logger.info(`${jobs.length} conversions to run (${skippedCount} already up-to-date)`);

  const stats: ConvertStats = { total: jobs.length, converted: 0, skipped: 0, failed: 0 };
  const jobSpinner = logger.spin(`Processing 0/${jobs.length}...`);

  let done = 0;
  const results = await processInBatches(jobs, concurrency, async (job) => {
    const result = await runJob(job);
    done++;
    if (done % 50 === 0 || done === jobs.length) {
      jobSpinner.text = `Processing ${done}/${jobs.length}...`;
    }
    return result;
  });

  for (const r of results) {
    stats[r]++;
  }

  jobSpinner.succeed(
    `Done: ${stats.converted} converted, ${stats.failed} failed (${skippedCount} cached)`,
  );

  if (stats.failed > 0) {
    logger.warn(`${stats.failed} conversions failed`);
  }
}
