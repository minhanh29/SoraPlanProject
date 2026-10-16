// Measure the bounding box of every catalog GLB and write it into
// backend/api/app/data/system_assets.json as dims {w: x, d: z, h: y} (GLB units, 3 decimals).
//
//   cd scripts/catalog && npm install && node measure.mjs
//   CATALOG_SRC=/path/to/assets node measure.mjs
//
// Meshopt-compressed files (assets-web) are supported too. Only `dims` is rewritten;
// frontAxis / rotationOffset fixes made by hand are kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const catalogSrc = process.env.CATALOG_SRC || path.join(repo, "assets");
const jsonPath = path.join(repo, "backend/api/app/data/system_assets.json");

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

const items = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const r3 = (v) => Math.round(v * 1000) / 1000;
const rows = [];

for (const item of items) {
  const file = path.join(catalogSrc, item.glbPath.replace(/^assets\//, ""));
  if (!fs.existsSync(file)) {
    console.warn(`missing ${file}`);
    continue;
  }
  const doc = await io.read(file);
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  item.dims = { w: r3(max[0] - min[0]), d: r3(max[2] - min[2]), h: r3(max[1] - min[1]) };
  rows.push({ name: item.name, category: item.category, ...item.dims, "w/d": r3(item.dims.w / item.dims.d) });
}

fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2) + "\n");
console.table(rows);
console.log(`Updated ${rows.length}/${items.length} dims in ${path.relative(repo, jsonPath)}`);
