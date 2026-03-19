import fs from "fs";
import path from "path";
import { logger } from "../logger.js";
import type { Config } from "../config.js";
import marketNameFormats from "./data/market-name-formats.json" with { type: "json" };

export interface Language {
  language: string;
  folder: string;
}

const ALL_LANGUAGES: Language[] = [
  { language: "brazilian", folder: "pt-BR" },
  { language: "bulgarian", folder: "bg" },
  { language: "czech", folder: "cs" },
  { language: "danish", folder: "da" },
  { language: "dutch", folder: "nl" },
  { language: "english", folder: "en" },
  { language: "finnish", folder: "fi" },
  { language: "french", folder: "fr" },
  { language: "german", folder: "de" },
  { language: "greek", folder: "el" },
  { language: "hungarian", folder: "hu" },
  { language: "italian", folder: "it" },
  { language: "japanese", folder: "ja" },
  { language: "koreana", folder: "ko" },
  { language: "latam", folder: "es-MX" },
  { language: "norwegian", folder: "no" },
  { language: "polish", folder: "pl" },
  { language: "portuguese", folder: "pt-PT" },
  { language: "romanian", folder: "ro" },
  { language: "russian", folder: "ru" },
  { language: "schinese", folder: "zh-CN" },
  { language: "spanish", folder: "es-ES" },
  { language: "swedish", folder: "sv" },
  { language: "tchinese", folder: "zh-TW" },
  { language: "thai", folder: "th" },
  { language: "turkish", folder: "tr" },
  { language: "ukrainian", folder: "uk" },
  { language: "vietnamese", folder: "vi" },
];

export function getLanguages(config: Config): Language[] {
  if (config.languages.includes("all")) return ALL_LANGUAGES;
  return ALL_LANGUAGES.filter((l) =>
    config.languages.includes(l.language) || config.languages.includes(l.folder)
  );
}

export interface TranslationContext {
  language: Language;
  defaultTranslations: Record<string, string>;
  selectedTranslations: Record<string, string>;
  defaultIdx: string[];
  selectedIdx: string[];
}

function loadTranslationFile(filePath: string): { keys: Record<string, string>; idx: string[] } {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const tokens = raw?.lang?.Tokens ?? raw?.Tokens ?? {};
  const keys: Record<string, string> = {};
  const idx: string[] = [];
  for (const [k, v] of Object.entries(tokens)) {
    const lower = k.toLowerCase();
    keys[lower] = v as string;
    idx.push(lower);
  }
  return { keys, idx };
}

let cachedDefault: { keys: Record<string, string>; idx: string[] } | null = null;

export function loadTranslationsFromDisk(
  config: Config,
  language: Language
): TranslationContext {
  const dataDir = path.resolve(config.paths.data, "output", "resource");

  if (!cachedDefault) {
    const engPath = path.join(dataDir, "csgo_english.json");
    if (!fs.existsSync(engPath)) {
      throw new Error(`English translation file not found: ${engPath}`);
    }
    cachedDefault = loadTranslationFile(engPath);
  }

  const langFile = path.join(dataDir, `csgo_${language.language}.json`);
  let selected = cachedDefault;
  if (fs.existsSync(langFile) && language.language !== "english") {
    selected = loadTranslationFile(langFile);
  }

  return {
    language,
    defaultTranslations: cachedDefault.keys,
    selectedTranslations: selected.keys,
    defaultIdx: cachedDefault.idx,
    selectedIdx: selected.idx,
  };
}

export function $t(ctx: TranslationContext, key: string | undefined, useDefault = false): string | null {
  if (!key) return null;
  const k = key.replace("#", "").toLowerCase();
  if (useDefault) return ctx.defaultTranslations[k] ?? null;
  return ctx.selectedTranslations[k] ?? ctx.defaultTranslations[k] ?? null;
}

export function $tTag(ctx: TranslationContext, key: string | undefined, useDefault = false): string | null {
  if (!key) return null;
  const k = key.replace("#", "").toLowerCase();
  const target = useDefault ? ctx.defaultTranslations : ctx.selectedTranslations;
  const targetIdx = useDefault ? ctx.defaultIdx : ctx.selectedIdx;
  const search = targetIdx.indexOf(k);
  if (search !== -1) {
    for (let i = search; i >= 0; i--) {
      if (!targetIdx[i].toLowerCase().includes("_tag")) {
        return target[targetIdx[i]];
      }
    }
  }
  return null;
}

export function $tc(ctx: TranslationContext, key: string, data: Record<string, string> = {}): string {
  const formats = (marketNameFormats as Record<string, Record<string, string>>)[ctx.language.folder];
  if (!formats) throw new Error(`Market name formats not found for '${ctx.language.folder}'`);
  const template = formats[key];
  if (!template) throw new Error(`Market name format key '${key}' not found for '${ctx.language.folder}'`);
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in data)) throw new Error(`$tc data key {${k}} not provided`);
    return data[k];
  });
}

export function resetTranslationCache(): void {
  cachedDefault = null;
}
