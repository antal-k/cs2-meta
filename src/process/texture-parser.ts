import fs from "fs";
import path from "path";
import { logger } from "../logger.js";

export interface TextureRef {
  type: string;
  file: string;
}

/**
 * Build a set of all PNG files in the output directory for fast existence checks.
 * Returns relative paths like "materials/models/.../foo.png".
 */
function buildFileIndex(outputDir: string): Set<string> {
  const index = new Set<string>();
  const walk = (dir: string, rel: string) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      try {
        if (fs.statSync(full).isDirectory()) {
          walk(full, relPath);
        } else if (entry.endsWith(".png")) {
          index.add(relPath);
        }
      } catch {
        // skip inaccessible entries
      }
    }
  };

  const scanDirs = ["materials", "items", "weapons"];
  for (const d of scanDirs) {
    const abs = path.join(outputDir, d);
    if (fs.existsSync(abs)) walk(abs, d);
  }

  return index;
}

/**
 * Convert a vtex path to a png relative path.
 * "materials/models/.../foo.vtex" → "materials/models/.../foo.png"
 */
function vtexToPng(vtexPath: string): string {
  return vtexPath.replace(/\.vtex$/, ".png");
}

/**
 * Parse textures from a .vmat file (KV1 format).
 * Extracts g_tPattern from the "Compiled Textures" block, keeping the full path.
 */
function parseTexturesFromVmat(vmatPath: string): TextureRef[] {
  let data: string;
  try {
    data = fs.readFileSync(vmatPath, "utf-8");
  } catch {
    return [];
  }

  const match = data.match(/g_tPattern"\s+"([^"]+\.vtex)"/);
  if (match?.[1]) {
    return [{ type: "g_tPattern", file: vtexToPng(match[1]) }];
  }
  return [];
}

/**
 * Parse textures from a .vcompmat file (KV3 format).
 * Extracts texture references from exposed_params, keeping full relative paths.
 * Falls back to following m_strSpecificContainerMaterial → .vmat file.
 */
function parseTexturesFromVcompmat(vcompmatPath: string, outputDir: string): TextureRef[] {
  let data: string;
  try {
    data = fs.readFileSync(vcompmatPath, "utf-8");
  } catch {
    return [];
  }

  const exposedIdx = data.indexOf('"exposed_params"');
  if (exposedIdx !== -1) {
    const textures = extractExposedParamsTextures(data, exposedIdx);
    if (textures.length > 0) return textures;
  }

  const matRefMatch = data.match(
    /m_strSpecificContainerMaterial\s*=\s*(?:resource_name:)?"([^"]+\.vmat)"/,
  );
  if (matRefMatch?.[1]) {
    const refVmatPath = path.join(outputDir, matRefMatch[1]);
    return parseTexturesFromVmat(refVmatPath);
  }

  return [];
}

function extractExposedParamsTextures(data: string, exposedIdx: number): TextureRef[] {
  const looseVarsIdx = data.indexOf("m_vecLooseVariables", exposedIdx);
  if (looseVarsIdx === -1) return [];

  const arrayStart = data.indexOf("[", looseVarsIdx);
  if (arrayStart === -1) return [];

  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < data.length; i++) {
    if (data[i] === "[") depth++;
    else if (data[i] === "]") {
      depth--;
      if (depth === 0) { arrayEnd = i; break; }
    }
  }
  if (arrayEnd === -1) return [];

  const looseVarsBlock = data.slice(arrayStart, arrayEnd + 1);
  const textures: TextureRef[] = [];
  let blockStart = -1;
  let blockDepth = 0;

  for (let i = 0; i < looseVarsBlock.length; i++) {
    if (looseVarsBlock[i] === "{") {
      if (blockDepth === 0) blockStart = i;
      blockDepth++;
    } else if (looseVarsBlock[i] === "}") {
      blockDepth--;
      if (blockDepth === 0 && blockStart !== -1) {
        const block = looseVarsBlock.slice(blockStart, i + 1);
        const nameMatch = block.match(/m_strName\s*=\s*"([^"]+)"/);
        const resMatch = block.match(/resource_name:"([^"]+\.vtex)"/);

        if (nameMatch?.[1] && resMatch?.[1]) {
          textures.push({ type: nameMatch[1], file: vtexToPng(resMatch[1]) });
        }

        blockStart = -1;
      }
    }
  }

  return textures;
}

/**
 * Resolve a texture ref against the file index.
 * If the full path exists, use it. Otherwise try matching by filename.
 */
function resolveTexture(
  tex: TextureRef,
  fileIndex: Set<string>,
  filesByName: Map<string, string>,
): TextureRef {
  if (fileIndex.has(tex.file)) return tex;

  const basename = tex.file.split("/").pop()!;
  const resolved = filesByName.get(basename);
  if (resolved) return { type: tex.type, file: resolved };

  return tex;
}

/**
 * Build a texture map for all paint kits by parsing vmat and vcompmat files.
 * Resolves texture paths against extracted files in the output directory.
 */
export function buildTextureMap(
  outputDir: string,
  paintKits: Record<string, any>,
): Record<string, TextureRef[]> {
  logger.info("Indexing extracted texture files...");
  const fileIndex = buildFileIndex(outputDir);
  logger.info(`File index: ${fileIndex.size} PNG files`);

  const filesByName = new Map<string, string>();
  for (const rel of fileIndex) {
    const name = rel.split("/").pop()!;
    if (!filesByName.has(name)) filesByName.set(name, rel);
  }

  const textureMap: Record<string, TextureRef[]> = {};
  const vmatsDir = path.join(
    outputDir, "materials", "models", "weapons", "customization", "paints", "vmats",
  );

  let vmatHits = 0;
  let vcompmatHits = 0;
  let misses = 0;
  let resolved = 0;
  let unresolved = 0;

  for (const [key, pk] of Object.entries(paintKits)) {
    const pkName: string = pk.name;
    if (!pkName) continue;

    let textures: TextureRef[] = [];

    // 1) Try vmat file
    const vmatPath = path.join(vmatsDir, `${pkName}.vmat`);
    textures = parseTexturesFromVmat(vmatPath);
    if (textures.length > 0) { vmatHits++; }

    // 2) Try vcompmat from composite_material_path
    if (textures.length === 0 && pk.vcompmat) {
      const vcompmatPath = path.join(outputDir, pk.vcompmat);
      textures = parseTexturesFromVcompmat(vcompmatPath, outputDir);
      if (textures.length > 0) vcompmatHits++;
    }

    // 3) Try legacy vcompmat path
    if (textures.length === 0) {
      const legacyPath = path.join(outputDir, "weapons", "paints", "legacy", `${pkName}.vcompmat`);
      textures = parseTexturesFromVcompmat(legacyPath, outputDir);
      if (textures.length > 0) vcompmatHits++;
    }

    // 4) Try glove vmat via vmt_path
    if (textures.length === 0 && pk.vmt_path) {
      const glovePath = path.join(outputDir, pk.vmt_path);
      textures = parseTexturesFromVmat(glovePath);
      if (textures.length > 0) vmatHits++;
    }

    if (textures.length === 0) {
      misses++;
      continue;
    }

    // Resolve each texture path against the file index
    textureMap[key] = textures.map((t) => {
      const r = resolveTexture(t, fileIndex, filesByName);
      if (fileIndex.has(r.file)) resolved++;
      else unresolved++;
      return r;
    });
  }

  logger.info(
    `Texture map: ${vmatHits} from vmat, ${vcompmatHits} from vcompmat, ${misses} without textures`,
  );
  logger.info(
    `Texture files: ${resolved} resolved on disk, ${unresolved} not found`,
  );

  return textureMap;
}
