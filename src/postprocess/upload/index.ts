import fs from "fs";
import path from "path";
import { logger } from "../../logger.js";
import type { Config, UploadConfig } from "../../config.js";
import type { UploadProvider } from "./provider.js";
import { BunnyProvider } from "./bunny.js";
import { S3Provider } from "./s3.js";

export type { UploadProvider };

const MANIFEST_FILE = ".upload-manifest.json";
type Manifest = Record<string, number>;

function loadManifest(dir: string): Manifest {
  const p = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function saveManifest(dir: string, manifest: Manifest): void {
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest));
}

function collectFiles(dir: string, extensions: Set<string>, base: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, extensions, base));
    } else {
      const ext = path.extname(entry.name).slice(1);
      if (extensions.has(ext)) {
        results.push(path.relative(base, full));
      }
    }
  }
  return results;
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

function resolveProvider(uploadConfig: UploadConfig): UploadProvider | null {
  switch (uploadConfig.provider) {
    case "bunny":
      if (!uploadConfig.bunny) {
        logger.error("Provider is 'bunny' but postprocess.upload.bunny config is missing");
        return null;
      }
      return new BunnyProvider(uploadConfig.bunny);
    case "s3":
      if (!uploadConfig.s3) {
        logger.error("Provider is 's3' but postprocess.upload.s3 config is missing");
        return null;
      }
      return new S3Provider(uploadConfig.s3);
    default:
      logger.error(`Unknown upload provider "${uploadConfig.provider}". Available: bunny, s3`);
      return null;
  }
}

export async function uploadImages(config: Config): Promise<void> {
  const upload = config.postprocess?.upload;
  if (!upload?.enabled) {
    logger.info("Upload is disabled, skipping");
    return;
  }

  const provider = resolveProvider(upload);
  if (!provider) return;

  const validationError = provider.validate();
  if (validationError) {
    logger.error(`Upload provider "${provider.name}" misconfigured: ${validationError}`);
    return;
  }

  const { formats, include_png, concurrency, base_path } = upload;
  const outputDir = path.resolve(config.paths.output);
  const extensions = new Set(formats);
  if (include_png) extensions.add("png");

  logger.step(`Upload: syncing ${[...extensions].join(", ").toUpperCase()} → ${provider.name}`);

  const scanSpinner = logger.spin("Scanning files to upload...");
  const allFiles = collectFiles(outputDir, extensions, outputDir);
  scanSpinner.succeed(`Found ${allFiles.length} files`);

  if (allFiles.length === 0) return;

  const manifest = loadManifest(outputDir);
  const pending: string[] = [];

  for (const rel of allFiles) {
    const abs = path.join(outputDir, rel);
    const mtime = fs.statSync(abs).mtimeMs;
    if (manifest[rel] === mtime) continue;
    pending.push(rel);
  }

  if (pending.length === 0) {
    logger.success(`All ${allFiles.length} files already uploaded`);
    return;
  }

  logger.info(`${pending.length} files to upload (${allFiles.length - pending.length} already synced)`);

  let uploaded = 0;
  let failed = 0;
  let done = 0;

  const uploadSpinner = logger.spin(`Uploading 0/${pending.length}...`);

  await processInBatches(pending, concurrency, async (rel) => {
    const abs = path.join(outputDir, rel);
    const remotePath = base_path ? `${base_path}/${rel}` : rel;

    const ok = await provider.upload(abs, remotePath);
    if (ok) {
      manifest[rel] = fs.statSync(abs).mtimeMs;
      uploaded++;
    } else {
      failed++;
    }

    done++;
    if (done % 20 === 0 || done === pending.length) {
      uploadSpinner.text = `Uploading ${done}/${pending.length}...`;
    }
  });

  saveManifest(outputDir, manifest);

  uploadSpinner.succeed(
    `Upload done: ${uploaded} uploaded, ${failed} failed (${allFiles.length - pending.length} cached)`,
  );

  if (failed > 0) {
    logger.warn(`${failed} files failed to upload`);
  }
}
