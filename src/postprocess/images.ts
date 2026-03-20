import fs from "fs";
import path from "path";
import sharp from "sharp";
import { logger } from "../logger.js";
import type { Config, ImageSizeDef } from "../config.js";

interface OutputSpec {
  dest: string;
  format: "avif" | "webp";
  quality: number;
  width?: number;
}

interface FileTask {
  src: string;
  outputs: OutputSpec[];
}

interface ConvertStats {
  total: number;
  converted: number;
  skipped: number;
  failed: number;
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
  return fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs;
}

function buildDest(src: string, format: string, sizeSuffix?: string): string {
  const ext = `.${format}`;
  if (sizeSuffix) {
    return src.replace(/\.png$/, `.${sizeSuffix}${ext}`);
  }
  return src.replace(/\.png$/, ext);
}

function encode(pipeline: sharp.Sharp, format: "avif" | "webp", quality: number): sharp.Sharp {
  return format === "avif"
    ? pipeline.avif({ quality, effort: 4 })
    : pipeline.webp({ quality, effort: 4 });
}

async function processFile(task: FileTask): Promise<{ converted: number; failed: number }> {
  let converted = 0;
  let failed = 0;

  const buf = fs.readFileSync(task.src);
  const meta = await sharp(buf).metadata();
  const srcWidth = meta.width ?? Infinity;

  const fullOutputs = task.outputs.filter((o) => !o.width);
  const sizedOutputs = task.outputs
    .filter((o) => o.width)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));

  for (const out of fullOutputs) {
    try {
      await encode(sharp(buf), out.format, out.quality).toFile(out.dest);
      converted++;
    } catch {
      failed++;
    }
  }

  let currentBuf = buf;
  let currentWidth = srcWidth;

  for (const out of sizedOutputs) {
    if (out.width! >= currentWidth) {
      try {
        await encode(sharp(currentBuf), out.format, out.quality).toFile(out.dest);
        converted++;
      } catch {
        failed++;
      }
      continue;
    }

    try {
      const resized = await sharp(currentBuf)
        .resize({ width: out.width, withoutEnlargement: true })
        .png()
        .toBuffer() as Buffer<ArrayBuffer>;

      currentBuf = resized;
      currentWidth = out.width!;

      await encode(sharp(resized), out.format, out.quality).toFile(out.dest);
      converted++;
    } catch {
      failed++;
    }
  }

  return { converted, failed };
}

function buildTasks(
  pngs: string[],
  formats: ("avif" | "webp")[],
  quality: Record<string, number>,
  sizes: ImageSizeDef[],
  skipExisting: boolean,
): { tasks: FileTask[]; totalOutputs: number; skippedOutputs: number } {
  const tasks: FileTask[] = [];
  let totalOutputs = 0;
  let skippedOutputs = 0;

  for (const src of pngs) {
    const outputs: OutputSpec[] = [];

    for (const format of formats) {
      const q = quality[format];

      const fullDest = buildDest(src, format);
      totalOutputs++;
      if (needsConversion(src, fullDest, skipExisting)) {
        outputs.push({ dest: fullDest, format, quality: q });
      } else {
        skippedOutputs++;
      }

      for (const size of sizes) {
        const dest = buildDest(src, format, size.suffix);
        totalOutputs++;
        if (needsConversion(src, dest, skipExisting)) {
          outputs.push({ dest, format, quality: q, width: size.width });
        } else {
          skippedOutputs++;
        }
      }
    }

    if (outputs.length > 0) {
      tasks.push({ src, outputs });
    }
  }

  return { tasks, totalOutputs, skippedOutputs };
}

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
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

  const { tasks, totalOutputs, skippedOutputs } = buildTasks(pngs, formats, quality, sizes, skip_existing);
  const pendingOutputs = totalOutputs - skippedOutputs;

  if (tasks.length === 0) {
    logger.success(`All ${skippedOutputs} outputs already up-to-date`);
    return;
  }

  logger.info(`${tasks.length} files to process (${pendingOutputs} outputs, ${skippedOutputs} cached)`);

  const stats: ConvertStats = { total: pendingOutputs, converted: 0, skipped: 0, failed: 0 };
  const jobSpinner = logger.spin(`Processing 0/${tasks.length} files...`);

  let done = 0;
  await processInBatches(tasks, concurrency, async (task) => {
    const result = await processFile(task);
    stats.converted += result.converted;
    stats.failed += result.failed;
    done++;
    if (done % 10 === 0 || done === tasks.length) {
      jobSpinner.text = `Processing ${done}/${tasks.length} files...`;
    }
  });

  jobSpinner.succeed(
    `Done: ${stats.converted} converted, ${stats.failed} failed (${skippedOutputs} cached)`,
  );

  if (stats.failed > 0) {
    logger.warn(`${stats.failed} conversions failed`);
  }
}
