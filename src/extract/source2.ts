import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { logger } from "../logger.js";
import type { Config, ExtractTarget } from "../config.js";
import { ensureBinary } from "./bin.js";

const execFileAsync = promisify(execFile);

interface Source2Options {
  input: string;
  output: string;
  decompile: boolean;
  filter?: string;
  extension?: string;
  threads?: number;
  vpkCache?: boolean;
  extraArgs?: string[];
}

function buildArgs(opts: Source2Options): string[] {
  const args = ["-i", opts.input, "-o", opts.output];
  if (opts.decompile) args.push("-d");
  if (opts.filter) args.push("-f", opts.filter);
  if (opts.extension) args.push("-e", opts.extension);
  if (opts.threads) args.push("--threads", opts.threads.toString());
  if (opts.vpkCache) args.push("--vpk_cache");
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

function getExtension(target: ExtractTarget): string | undefined {
  if (target.extension !== undefined) return target.extension || undefined;
  switch (target.type) {
    case "images":
    case "textures":
      return "vtex_c";
    case "materials":
      return "vmat_c";
    case "composites":
      return "vcompmat_c";
    case "models":
      return "vmdl_c";
    case "sounds":
      return "vsnd_c";
    default:
      return undefined;
  }
}

export async function extractTarget(
  config: Config,
  target: ExtractTarget,
  vpkFile: string,
  outputDir: string
): Promise<void> {
  const cliPath = await ensureBinary(config);
  const ext = getExtension(target);

  const opts: Source2Options = {
    input: vpkFile,
    output: outputDir,
    decompile: true,
    filter: target.filter,
    extension: ext || undefined,
    threads: config.extract.threads,
    vpkCache: config.extract.vpk_cache,
    extraArgs: target.extra_args,
  };

  const args = buildArgs(opts);
  logger.info(`Extracting ${target.type}: ${target.filter} (${ext ?? "all"})`);
  logger.debug(`${cliPath} ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      maxBuffer: 1024 * 1024 * 100,
      timeout: 600_000,
    });
    if (stdout) logger.debug(stdout.slice(0, 500));
    if (stderr) logger.warn(stderr.slice(0, 500));
    logger.success(`Extracted ${target.type}`);
  } catch (err: any) {
    if (err.stdout || err.stderr) {
      logger.warn(`Extraction for ${target.type} (${target.filter}) exited with error but may have partially succeeded`);
      if (err.stderr) logger.warn(err.stderr.slice(0, 300));
    } else {
      logger.error(`Extraction failed for ${target.type}:`, (err as Error).message);
      throw err;
    }
  }
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const errors: Error[] = [];

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        await fn(items[i]);
      } catch (err) {
        errors.push(err as Error);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);

  if (errors.length > 0) {
    logger.error(`${errors.length} extraction(s) failed`);
    throw errors[0];
  }
}

export async function extractAll(config: Config): Promise<void> {
  logger.step("Extract: VPK assets via Source2Viewer-CLI");

  const vpkFile = path.resolve(config.paths.data, "vpk", "pak01_dir.vpk");
  const outputDir = path.resolve(config.paths.output);

  const enabledTargets = config.extract.targets.filter((t) => t.enabled);
  if (enabledTargets.length === 0) {
    logger.info("No extraction targets enabled");
    return;
  }

  const concurrency = config.extract.parallel ?? 1;
  logger.info(
    `${enabledTargets.length} targets, concurrency ${concurrency} (threads/target: ${config.extract.threads})`,
  );

  if (concurrency <= 1) {
    for (const target of enabledTargets) {
      await extractTarget(config, target, vpkFile, outputDir);
    }
  } else {
    await runPool(enabledTargets, concurrency, (target) =>
      extractTarget(config, target, vpkFile, outputDir),
    );
  }
}

export async function extractOnly(config: Config, targetType: string): Promise<void> {
  const target = config.extract.targets.find((t) => t.type === targetType);
  if (!target) {
    logger.error(`Unknown extract target: ${targetType}`);
    return;
  }

  const vpkFile = path.resolve(config.paths.data, "vpk", "pak01_dir.vpk");
  const outputDir = path.resolve(config.paths.output);
  await extractTarget(config, { ...target, enabled: true }, vpkFile, outputDir);
}
