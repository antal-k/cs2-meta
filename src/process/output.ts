import fs from "fs";
import path from "path";
import { logger } from "../logger.js";
import type { Config } from "../config.js";

export function saveTypeJson(
  config: Config,
  langFolder: string,
  typeName: string,
  data: any[]
): void {
  const outDir = path.resolve(config.paths.output, langFolder);
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${typeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 1));
  logger.debug(`Saved ${data.length} items to ${filePath}`);
}

export function groupAll(config: Config, langFolder: string, typeNames: string[]): void {
  const outDir = path.resolve(config.paths.output, langFolder);
  const allData: Record<string, any> = {};

  for (const typeName of typeNames) {
    const filePath = path.join(outDir, `${typeName}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.id) allData[item.id] = item;
        }
      }
    } catch {
      logger.warn(`Could not read ${filePath} for grouping`);
    }
  }

  const allPath = path.join(outDir, "all.json");
  fs.writeFileSync(allPath, JSON.stringify(allData));
  logger.debug(`Grouped ${Object.keys(allData).length} items into ${allPath}`);
}
