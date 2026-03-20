#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, applyCliOverrides, type Config } from "./config.js";
import { logger } from "./logger.js";
import { download, downloadBase, downloadStatic } from "./download/index.js";
import { extract } from "./extract/index.js";
import { postprocess, uploadImages } from "./postprocess/index.js";
import { process as processItems } from "./process/index.js";
import { runPipeline } from "./pipeline.js";

const program = new Command();

program
  .name("cs2-meta")
  .description("CS2 file extractor and item data processor")
  .version("1.0.0")
  .option("-c, --config <path>", "Path to config file")
  .option("-s, --set <key=value...>", "Override config values (e.g. extract.threads=16)")
  .option("-v, --verbose", "Enable debug logging")
  .option("-q, --quiet", "Only show errors");

function resolveConfig(opts: Record<string, any>): Config {
  let config = loadConfig(opts.config);
  if (opts.set) {
    const overrides: Record<string, string> = {};
    for (const s of opts.set) {
      const [key, ...rest] = s.split("=");
      overrides[key] = rest.join("=");
    }
    config = applyCliOverrides(config, overrides);
  }
  if (opts.verbose) logger.setLevel("debug");
  if (opts.quiet) logger.setLevel("error");
  return config;
}

program
  .command("pipeline")
  .description("Run full pipeline: download -> extract -> process -> postprocess -> upload")
  .option("--force", "Force re-download even if up to date")
    .option("--skip-extract", "Skip extraction step")
    .option("--skip-postprocess", "Skip image post-processing step")
    .option("--skip-upload", "Skip CDN upload step")
    .option("--skip-process", "Skip processing step")
    .option("--languages <langs>", "Comma-separated language codes")
    .action(async (cmdOpts) => {
    const config = resolveConfig(program.opts());
    await runPipeline(config, {
      force: cmdOpts.force,
      skipExtract: cmdOpts.skipExtract,
      skipPostprocess: cmdOpts.skipPostprocess,
      skipUpload: cmdOpts.skipUpload,
      skipProcess: cmdOpts.skipProcess,
      languages: cmdOpts.languages?.split(","),
    });
  });

program
  .command("download")
  .description("Download VPK files from Steam")
  .option("--force", "Force re-download")
  .option("--base-only", "Download only text files (items_game, languages)")
  .option("--static-only", "Download only static VPK archives")
  .action(async (cmdOpts) => {
    const config = resolveConfig(program.opts());
    if (cmdOpts.force) config.download.force = true;
    if (cmdOpts.baseOnly) {
      await downloadBase(config);
    } else if (cmdOpts.staticOnly) {
      await downloadStatic(config);
    } else {
      await download(config);
    }
  });

program
  .command("extract")
  .description("Extract assets from VPK files")
  .option("--only <type>", "Extract only a specific target type (images, textures, models, sounds, thumbnails)")
  .action(async (cmdOpts) => {
    const config = resolveConfig(program.opts());
    await extract(config, cmdOpts.only);
  });

program
  .command("postprocess")
  .description("Convert extracted PNG images to AVIF and WebP")
  .action(async () => {
    const config = resolveConfig(program.opts());
    await postprocess(config);
  });

program
  .command("upload")
  .description("Upload converted images to CDN (bunny, s3)")
  .action(async () => {
    const config = resolveConfig(program.opts());
    await uploadImages(config);
  });

program
  .command("process")
  .description("Process item data and generate JSON output")
  .option("--languages <langs>", "Comma-separated language codes (e.g. en,fr,de)")
  .action(async (cmdOpts) => {
    const config = resolveConfig(program.opts());
    const languages = cmdOpts.languages?.split(",");
    await processItems(config, languages);
  });

program.parseAsync().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
