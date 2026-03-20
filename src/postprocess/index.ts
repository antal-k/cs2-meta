import type { Config } from "../config.js";
import { convertImages } from "./images.js";
import { uploadImages } from "./upload/index.js";

export { convertImages, uploadImages };

export async function postprocess(config: Config): Promise<void> {
  await convertImages(config);
  await uploadImages(config);
}
