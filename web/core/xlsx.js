// Minimal .xlsx reader with no dependencies. Works in the browser and in Node.
// An .xlsx file is a zip of XML files; this reads every sheet (hidden ones too) into arrays of raw values.
// Numbers stay numbers (dates and times come back as Excel serial numbers), text stays text.
// inflateRaw(Uint8Array) -> Promise<Uint8Array> is passed in, so each side uses its own decompressor.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function unzip(bytes, inflateRaw) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This isn’t an .xlsx file (or it’s damaged). Save it as Excel Workbook (.xlsx) and try again.");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const method = u16(bytes, p + 10), size = u32(bytes, p + 20), nameLen = u16(bytes, p + 28), extra = u16(bytes, p + 30), comment = u16(bytes, p + 32), local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) files[name] = raw;
    else if (method === 8) files[name] = await inflateRaw(raw);
    else throw new Error(`This .xlsx uses an unsupported compression (${method}). Open it in Excel and save it again.`);
  }
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, dec.decode(v)]));
}

const decode = (s) => String(s)
  .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };
const textOf = (xml) => decode((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").match(/<t\b[^>]*>[\s\S]*?<\/t>|<t\b[^>]*\/>/g) || []).map((t) => t.replace(/^<t\b[^>]*>|<\/t>$|^<t\b[^>]*\/>$/g, "")).join(""));
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export async function readXlsx(bytes, inflateRaw) {
  const files = await unzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
  const wb = files["xl/workbook.xml"];
  if (!wb) throw new Error("No workbook found inside this file.");
  const rels = {};
  for (const m of (files["xl/_rels/workbook.xml.rels"] || "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), target = attr(m[0], "Target");
    if (id && target) rels[id] = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  }
  const shared = (files["xl/sharedStrings.xml"] || "").match(/<si>[\s\S]*?<\/si>|<si\/>/g)?.map(textOf) || [];
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name"), state = attr(m[0], "state") || "visible", rid = attr(m[0], "r:id");
    const xml = files[rels[rid]];
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rIdx = Number(attr(r[1], "r")) - 1;
      const row = [];
      for (const c of (r[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], "r"), t = attr(c[1], "t"), body = c[2] || "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = null;
        if (t === "s") val = v != null ? shared[Number(v)] ?? null : null;
        else if (t === "inlineStr") val = textOf(body);
        else if (t === "str" || t === "e") val = v != null ? decode(v) : null;
        else if (t === "b") val = v === "1";
        else if (v != null) val = Number(v);
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[Number.isFinite(rIdx) && rIdx >= 0 ? rIdx : rows.length] = row;
    }
    for (let i = 0; i < rows.length; i++) rows[i] = Array.from(rows[i] || [], (x) => (x === undefined ? null : x));
    sheets.push({ name, state, rows });
  }
  return { sheets };
}

// Decompressors for each side.
export const browserInflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
