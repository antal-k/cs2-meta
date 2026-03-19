import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import path from "path";
import { logger } from "../logger.js";
import type { Config } from "../config.js";

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

function getFFmpegOutputOptions(format: string): string[] {
  switch (format) {
    case "avif":
      return ["-c:v", "libaom-av1", "-still-picture", "1", "-q:v", "30"];
    case "webp":
      return ["-c:v", "libwebp", "-quality", "80"];
    default:
      return [];
  }
}

function getExtension(format: string): string {
  switch (format) {
    case "avif":
      return "avif";
    case "webp":
      return "webp";
    default:
      return "jpg";
  }
}

async function extractFrame(
  videoUrl: string,
  outputPath: string,
  seekTime: number,
  format: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });

    const command = ffmpeg(videoUrl)
      .seekInput(seekTime)
      .frames(1)
      .output(outputPath)
      .outputOptions(getFFmpegOutputOptions(format));

    command
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

export interface HighlightVideo {
  id: string;
  video: string;
}

export async function extractThumbnails(
  config: Config,
  videos: HighlightVideo[]
): Promise<void> {
  if (!config.thumbnails.enabled) {
    logger.info("Thumbnail extraction disabled");
    return;
  }

  logger.step("Extract: video thumbnails");

  const ext = getExtension(config.thumbnails.format);
  const outputBase = path.resolve(config.paths.output, "highlights", "thumbnails");
  let extracted = 0;
  let skipped = 0;

  for (const video of videos) {
    const parts = video.id.split("_");
    const subDir = parts[0];
    const outputPath = path.join(outputBase, subDir, `${video.id}_ww.${ext}`);

    if (fs.existsSync(outputPath)) {
      skipped++;
      continue;
    }

    try {
      await extractFrame(video.video, outputPath, config.thumbnails.seek_time, config.thumbnails.format);
      extracted++;
    } catch (err) {
      logger.warn(`Failed thumbnail for ${video.id}: ${(err as Error).message}`);
    }
  }

  logger.success(`Thumbnails: ${extracted} extracted, ${skipped} skipped (already exist)`);
}
