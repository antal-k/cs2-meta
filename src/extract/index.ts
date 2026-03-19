import type { Config } from "../config.js";
import { extractAll, extractOnly } from "./source2.js";
import { extractThumbnails, type HighlightVideo } from "./thumbnails.js";
import { ensureBinary } from "./bin.js";

export { extractAll, extractOnly, extractThumbnails, ensureBinary };
export type { HighlightVideo };

export async function extract(config: Config, only?: string): Promise<void> {
  if (only === "thumbnails") {
    return;
  }

  if (only) {
    await extractOnly(config, only);
  } else {
    await extractAll(config);
  }
}
