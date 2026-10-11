// Local JSON-file store for development and demos. Seeds itself with fictional data on first run.
import fs from "node:fs";
import path from "node:path";
import { createMemStore } from "../../web/core/memstore.js";
import { buildSeed } from "../../web/core/seed.js";

export function createFileStore(file) {
  let initial = null;
  if (file && fs.existsSync(file)) {
    try { initial = JSON.parse(fs.readFileSync(file, "utf8")); } catch { initial = null; }
  }
  if (!initial) initial = buildSeed();
  let timer = null;
  const save = (data) => {
    if (!file) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    }, 150);
  };
  const store = createMemStore(initial, save);
  save(store.dump());
  return store;
}
