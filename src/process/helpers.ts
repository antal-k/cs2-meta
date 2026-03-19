import weaponsData from "./data/weapons.json" with { type: "json" };
import graffitiData from "./data/graffiti-variations.json" with { type: "json" };

export const WEAPON_NAMES: string[] = weaponsData.names;
export const WEAPON_IDS: Record<string, number> = weaponsData.ids;
export const KNIVES = weaponsData.knives;
export const WEAPON_CATEGORIES: Record<string, string> = weaponsData.categories;

export function getWeaponName(str: string): string | false {
  for (const weapon of WEAPON_NAMES) {
    if (str.includes(weapon)) return weapon;
  }
  return false;
}

export function isNotWeapon(str: string): boolean {
  return !str.includes("weapon_") || str.includes("weapon_knife") || str.includes("weapon_bayonet");
}

export function getCategory(weapon: string): string | null {
  return WEAPON_CATEGORIES[weapon] ?? (
    weapon.includes("weapon_knife") || weapon.includes("weapon_bayonet")
      ? "sfui_invpanel_filter_melee"
      : weapon.includes("gloves") || weapon.includes("handwraps")
        ? "sfui_invpanel_filter_gloves"
        : null
  );
}

interface WearRange {
  wear: string;
  min: number;
  max: number;
}

const WEAR_RANGES: WearRange[] = [
  { wear: "SFUI_InvTooltip_Wear_Amount_0", min: 0.0, max: 0.07 },
  { wear: "SFUI_InvTooltip_Wear_Amount_1", min: 0.07, max: 0.15 },
  { wear: "SFUI_InvTooltip_Wear_Amount_2", min: 0.15, max: 0.38 },
  { wear: "SFUI_InvTooltip_Wear_Amount_3", min: 0.38, max: 0.45 },
  { wear: "SFUI_InvTooltip_Wear_Amount_4", min: 0.45, max: 1.0 },
];

export function getWears(minFloat: number, maxFloat: number): string[] {
  return WEAR_RANGES.filter((r) => r.max > minFloat && r.min < maxFloat).map((r) => r.wear);
}

const DOPPLER_PHASES: Record<number, string> = {
  415: "Ruby", 416: "Sapphire", 417: "Black Pearl",
  418: "Phase 1", 419: "Phase 2", 420: "Phase 3", 421: "Phase 4",
  568: "Emerald", 569: "Phase 1", 570: "Phase 2", 571: "Phase 3", 572: "Phase 4",
  617: "Black Pearl", 618: "Phase 2", 619: "Sapphire",
  852: "Phase 1", 853: "Phase 2", 854: "Phase 3", 855: "Phase 4",
  1119: "Emerald", 1120: "Phase 1", 1121: "Phase 2", 1122: "Phase 3", 1123: "Phase 4",
};

export function getDopplerPhase(paintIndex: string | number): string | undefined {
  return DOPPLER_PHASES[Number(paintIndex)];
}

export function isExclusive(name: string): boolean {
  return ["halo_01", "hlalyx_01", "hades_01"].includes(name);
}

export function getRarityColor(id: string | undefined): string | null {
  const lower = id?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    rarity_default: "#ded6cc",
    rarity_legendary_character: "#d32ce6", rarity_legendary_weapon: "#d32ce6", rarity_legendary: "#d32ce6",
    rarity_ancient_character: "#eb4b4b", rarity_ancient_weapon: "#eb4b4b", rarity_ancient: "#eb4b4b",
    rarity_mythical_character: "#8847ff", rarity_mythical_weapon: "#8847ff", rarity_mythical: "#8847ff",
    rarity_rare_character: "#4b69ff", rarity_rare_weapon: "#4b69ff", rarity_rare: "#4b69ff",
    rarity_common_weapon: "#b0c3d9", rarity_common: "#b0c3d9",
    rarity_uncommon_weapon: "#5e98d9",
    rarity_contraband: "#e4ae39", rarity_contraband_weapon: "#e4ae39",
  };
  return map[lower] ?? null;
}

export function getCollectibleRarity(prefab: string): string | null {
  const keys = prefab.split(" ");
  for (const key of keys) {
    if (key.includes("tournament_pass_prefab") || key === "season_pass" || key === "season_tiers") return "rarity_common";
    if (key.includes("tournament_journal_prefab") || key.includes("_coin") || key.includes("trophy") || key === "map_token" || key === "pickem_trophy" || key === "prestige_coin") return "rarity_ancient";
  }
  return null;
}

export function skinMarketHashName(opts: {
  itemName: string; pattern: string; wear: string;
  isStatTrak: boolean; isSouvenir: boolean; isWeapon: boolean; isVanilla: boolean;
}): string {
  const { itemName, pattern, wear, isStatTrak, isSouvenir, isWeapon, isVanilla } = opts;
  if (isWeapon) {
    if (isStatTrak) return `StatTrak™ ${itemName} | ${pattern} (${wear})`;
    if (isSouvenir) return `Souvenir ${itemName} | ${pattern} (${wear})`;
    return `${itemName} | ${pattern} (${wear})`;
  }
  if (isVanilla) {
    if (isStatTrak) return `★ StatTrak™ ${itemName}`;
    return `★ ${itemName}`;
  }
  if (isStatTrak) return `★ StatTrak™ ${itemName} | ${pattern} (${wear})`;
  return `★ ${itemName} | ${pattern} (${wear})`;
}

export function formatSkinImage(url: string, wear: string): string {
  if (["SFUI_InvTooltip_Wear_Amount_2", "SFUI_InvTooltip_Wear_Amount_3"].includes(wear)) {
    return url.replace("_light_png", "_medium_png");
  }
  if (wear === "SFUI_InvTooltip_Wear_Amount_4") {
    return url.replace("_light_png", "_heavy_png");
  }
  return url;
}

export function getFinishStyleLink(id: number): string | null {
  const base = "https://www.counter-strike.net/workshop/workshopfinishes#";
  const map: Record<number, string> = {
    1: "solidcolorstyle", 2: "hydrographic", 3: "spraypaint",
    4: "anodized", 5: "anodizedmulticolored", 6: "anodizedairbrushed",
    7: "custompaint", 8: "patina", 9: "gunsmith", 10: "patina",
  };
  return map[id] ? base + map[id] : null;
}

export function getGraffitiVariations(material: string): number[] {
  return (graffitiData as Record<string, number[]>)[material] ?? [];
}

export function getPlayerNameOfHighlight(id: string, players: Record<string, string>): string {
  let name = id.split("_")[1] ?? "";

  const replacements: Record<string, string> = {
    shiro: "sh1ro", magix: "magixx", torszi: "torzsi", zontix: "zont1x",
    techno: "techno4k", tehcno: "techno4k", wonderful: "w0nderful",
    yuuri: "yuurih", flames: "flamez", mezi: "mezii", senznu: "senzu",
    jimphat: "jimpphat",
  };
  for (const [from, to] of Object.entries(replacements)) {
    if (name.startsWith(from)) { name = name.replace(from, to); break; }
  }

  if (name === "mongolzscaredofs1mplevsfazeonanubis") name = "s1mple";
  if (name === "boosttorszitoentryvsspiritonnuke") name = "torzsi";

  if (name.startsWith("qf-") || name.startsWith("sf-") || name.startsWith("gf-")) {
    name = name.replace(/^(qf|sf|gf)-/, "");
  }

  return Object.values(players).find((p) => name.startsWith(p.toLowerCase())) ?? "Unknown Player";
}

export function filterUniqueByAttribute<T>(items: T[], attribute: keyof T): T[] {
  const seen = new Set();
  return items.filter((item) => {
    const val = item[attribute];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

export function getImageUrl(p: string): string {
  return "/panorama/images/" + p + "_png.png";
}
