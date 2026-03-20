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

interface ExtractResult {
  target: ExtractTarget;
  status: "ok" | "partial" | "failed";
  error?: string;
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

function targetLabel(target: ExtractTarget): string {
  return `${target.type}: ${target.filter}`;
}

async function runTarget(
  config: Config,
  target: ExtractTarget,
  vpkFile: string,
  outputDir: string,
): Promise<ExtractResult> {
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
  logger.debug(`${cliPath} ${args.join(" ")}`);

  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      maxBuffer: 1024 * 1024 * 100,
      timeout: 600_000,
    });
    if (stdout) logger.debug(stdout.slice(0, 500));
    if (stderr) logger.debug(stderr.slice(0, 500));
    return { target, status: "ok" };
  } catch (err: any) {
    if (err.stdout || err.stderr) {
      if (err.stderr) logger.debug(err.stderr.slice(0, 300));
      return { target, status: "partial" };
    }
    return { target, status: "failed", error: (err as Error).message };
  }
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
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

  const total = enabledTargets.length;
  const concurrency = config.extract.parallel ?? 1;
  logger.info(
    `${total} targets, concurrency ${concurrency} (threads/target: ${config.extract.threads})`,
  );

  const start = Date.now();
  let done = 0;

  const spinner = logger.spin(`Extracting [0/${total}]...`);
  const updateSpinner = () => {
    spinner.text = `Extracting [${done}/${total}]...`;
  };

  let results: ExtractResult[];

  if (concurrency <= 1) {
    results = [];
    for (const target of enabledTargets) {
      spinner.text = `Extracting [${done + 1}/${total}] ${targetLabel(target)}...`;
      const result = await runTarget(config, target, vpkFile, outputDir);
      results.push(result);
      done++;
      updateSpinner();
    }
  } else {
    results = await runPool(enabledTargets, concurrency, async (target) => {
      const result = await runTarget(config, target, vpkFile, outputDir);
      done++;
      updateSpinner();
      return result;
    });
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const ok = results.filter((r) => r.status === "ok").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const failed = results.filter((r) => r.status === "failed").length;

  if (failed > 0) {
    spinner.warn(`Extraction: ${ok} ok, ${partial} partial, ${failed} failed (${elapsed}s)`);
  } else if (partial > 0) {
    spinner.warn(`Extraction: ${ok} ok, ${partial} partial (${elapsed}s)`);
  } else {
    spinner.succeed(`Extraction complete: ${total} targets in ${elapsed}s`);
  }

  for (const r of results) {
    const label = targetLabel(r.target);
    if (r.status === "ok") {
      logger.success(label);
    } else if (r.status === "partial") {
      logger.warn(`${label} (partial)`);
    } else {
      logger.error(`${label} — ${r.error}`);
    }
  }

  if (failed > 0) {
    throw new Error(`${failed} extraction(s) failed`);
  }
}

export async function extractOnly(config: Config, targetType: string): Promise<void> {
  const targets = config.extract.targets.filter((t) => t.type === targetType);
  if (targets.length === 0) {
    logger.error(`Unknown extract target: ${targetType}`);
    return;
  }

  logger.step(`Extract: ${targetType}`);

  const vpkFile = path.resolve(config.paths.data, "vpk", "pak01_dir.vpk");
  const outputDir = path.resolve(config.paths.output);

  const start = Date.now();
  const total = targets.length;

  const spinner = logger.spin(`Extracting [0/${total}]...`);

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    spinner.text = `Extracting [${i + 1}/${total}] ${targetLabel(target)}...`;
    const result = await runTarget(config, { ...target, enabled: true }, vpkFile, outputDir);

    if (result.status === "failed") {
      spinner.fail(`${targetLabel(target)} — ${result.error}`);
      throw new Error(`Extraction failed for ${targetType}`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  spinner.succeed(`Extraction complete: ${total} target(s) in ${elapsed}s`);
}

export { runTarget as extractTarget };
