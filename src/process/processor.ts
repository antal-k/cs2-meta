import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "../logger.js";
import type { Config, ItemTypeDef, ItemFieldDef } from "../config.js";
import type { GameState } from "./parser.js";
import type { TranslationContext } from "./languages.js";
import { $t } from "./languages.js";
import { getImageUrl } from "./helpers.js";

function getSourceData(state: GameState, source: string): any[] {
  switch (source) {
    case "items":
      return Object.values(state.items);
    case "sticker_kits":
      return state.stickerKits;
    case "keychain_definitions":
      return state.keychainDefinitions;
    case "highlight_reels":
      return state.highlightReels;
    default:
      return [];
  }
}

function matchFilter(item: any, filter: Record<string, any>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === "exclude") {
      for (const [exKey, exValues] of Object.entries(condition as Record<string, string[]>)) {
        if (Array.isArray(exValues) && exValues.includes(item[exKey])) return false;
      }
      continue;
    }

    const cond = condition as Record<string, any>;

    if (cond.equals !== undefined && item[key] !== cond.equals) return false;
    if (cond.exists !== undefined && cond.exists === true && item[key] === undefined) return false;
    if (cond.not_exists !== undefined && cond.not_exists === true && item[key] !== undefined) return false;
    if (cond.starts_with !== undefined && (typeof item[key] !== "string" || !item[key].startsWith(cond.starts_with))) return false;
    if (cond.contains !== undefined && (typeof item[key] !== "string" || !item[key].includes(cond.contains))) return false;
  }
  return true;
}

function resolveField(item: any, fieldDef: ItemFieldDef, ctx: TranslationContext): any {
  if (fieldDef.value !== undefined) return fieldDef.value;

  if (fieldDef.template !== undefined) {
    return fieldDef.template.replace(/\{(?:sha:)?(\w+)\}/g, (match, k) => {
      const val = String(item[k] ?? "");
      if (match.startsWith("{sha:")) {
        return crypto.createHash("sha1").update(val).digest("hex").slice(0, 8);
      }
      return val;
    });
  }

  if (fieldDef.nested !== undefined) {
    const nested = item[fieldDef.nested];
    if (!nested || typeof nested !== "object") return null;
    if (fieldDef.first_key) return Object.keys(nested)[0] ?? null;
    return nested;
  }

  if (fieldDef.key === undefined) return null;

  let value = item[fieldDef.key];

  if (fieldDef.translate && value) {
    value = $t(ctx, value) ?? value;
  }

  if (fieldDef.prefix && value) {
    value = fieldDef.prefix + value;
  }

  if (fieldDef.transform === "cdn_image" && value) {
    value = getImageUrl(value.toLowerCase());
  }

  if (fieldDef.transform === "patch_image" && value) {
    value = getImageUrl(`econ/patches/${value}`);
  }

  return value;
}

export function processConfigDrivenType(
  typeName: string,
  typeDef: ItemTypeDef,
  state: GameState,
  ctx: TranslationContext,
  config: Config
): any[] {
  if (!typeDef.enabled) return [];

  if (typeDef.source === "static") {
    if (typeDef.static_items) {
      return typeDef.static_items.map((si) => ({
        id: si.id,
        type: "Tool",
        name: $t(ctx, si.name_key) ?? si.name_key,
        description: $t(ctx, si.description_key) ?? si.description_key,
        image: getImageUrl(si.image),
      }));
    }
    if (typeDef.static_items_file) {
      const filePath = path.resolve(typeDef.static_items_file);
      let altPath = path.resolve("src/process", typeDef.static_items_file.replace("data/", "data/"));
      if (!fs.existsSync(filePath) && fs.existsSync(altPath)) {
        // Try relative to src/process
      }
      const lookPaths = [filePath, altPath, path.resolve("src/process/data", path.basename(typeDef.static_items_file))];
      let items: any[] = [];
      for (const p of lookPaths) {
        if (fs.existsSync(p)) {
          items = JSON.parse(fs.readFileSync(p, "utf-8"));
          break;
        }
      }
      return items.map((si: any) => ({
        id: si.id,
        name: $t(ctx, si.name_key) ?? si.name_key,
        description: si.description_key ? ($t(ctx, si.description_key) ?? si.description_key) : undefined,
        image: getImageUrl(si.image),
      }));
    }
    return [];
  }

  const sourceData = getSourceData(state, typeDef.source);
  if (sourceData.length === 0) {
    logger.warn(`No source data for ${typeName} (source: ${typeDef.source})`);
    return [];
  }

  const filtered = typeDef.filter
    ? sourceData.filter((item) => matchFilter(item, typeDef.filter!))
    : sourceData;

  if (!typeDef.fields) return filtered;

  return filtered.map((item) => {
    const result: Record<string, any> = {};
    for (const [fieldName, fieldDef] of Object.entries(typeDef.fields!)) {
      const value = resolveField(item, fieldDef, ctx);
      if (value !== null && value !== undefined) {
        result[fieldName] = value;
      }
    }
    return result;
  });
}
