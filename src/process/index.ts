import { logger } from "../logger.js";
import type { Config } from "../config.js";
import { loadGameState, type GameState } from "./parser.js";
import { getLanguages, loadTranslationsFromDisk, resetTranslationCache } from "./languages.js";
import { processConfigDrivenType } from "./processor.js";
import { TRANSFORMS } from "./transforms.js";
import { saveTypeJson, groupAll } from "./output.js";

const GROUPED_TYPES = [
  "agents", "collectibles", "collections", "crates", "graffiti", "keys",
  "music_kits", "patches", "skins_not_grouped", "stickers", "keychains",
  "tools", "sticker_slabs",
];

export async function process(config: Config, languageFilter?: string[]): Promise<void> {
  logger.step("Process: item data");

  const state = loadGameState(config);
  const languages = getLanguages(config);
  const filteredLangs = languageFilter
    ? languages.filter((l) => languageFilter.includes(l.folder) || languageFilter.includes(l.language))
    : languages;

  resetTranslationCache();

  for (const lang of filteredLangs) {
    logger.info(`Processing language: ${lang.language} (${lang.folder})`);
    const ctx = loadTranslationsFromDisk(config, lang);

    const allTypeNames: string[] = [];

    // Config-driven types
    for (const [typeName, typeDef] of Object.entries(config.process.item_types)) {
      if (!typeDef.enabled) continue;
      const items = processConfigDrivenType(typeName, typeDef, state, ctx, config);
      saveTypeJson(config, lang.folder, typeName, items);
      allTypeNames.push(typeName);
      logger.debug(`  ${typeName}: ${items.length} items`);
    }

    // Transform-driven types
    for (const [typeName, transformDef] of Object.entries(config.process.transforms)) {
      if (!transformDef.enabled) continue;
      const fn = TRANSFORMS[transformDef.transform];
      if (!fn) {
        logger.warn(`Transform '${transformDef.transform}' not found, skipping ${typeName}`);
        continue;
      }
      const items = fn(state, ctx, config);
      saveTypeJson(config, lang.folder, typeName, items);
      allTypeNames.push(typeName);
      logger.debug(`  ${typeName}: ${items.length} items`);
    }

    // Group into all.json
    if (config.process.group) {
      groupAll(config, lang.folder, GROUPED_TYPES);
    }
  }

  logger.success(`Processed ${filteredLangs.length} languages`);
}
