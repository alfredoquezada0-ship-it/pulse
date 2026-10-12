// Behavior bank. Managers: write, edit, tag by LOB, reorder and retire the behaviors their supervisors coach, with an
// AI draft to start from. Supervisors: the same page, read-only, showing the behaviors for their LOB.
import { KPIS, LOBS } from "../core/constants.js";
import { WHEN } from "../core/bank.js";
import { esc, $, $$, sourceTag, modal, setBank } from "../ui.js";

const head = (title, sub, actions = "") => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
const KPI_NAME = Object.fromEntries(KPIS.map((k) => [k.id, k.name]));
const WHEN_NAME = Object.fromEntries(WHEN.map((w) => [w.id, w.name]));
const ul = (xs, cls = "small") => (xs?.length ? `<ul class="${cls}">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="small muted">—</p>`);

function card(b, editable, i, n) {
  return `<div class="card bcard${b.active ? "" : " retired"}" data-key="${esc(b.id)}">
    <div class="card-h"><div><h3>${esc(b.name)}${b.full && b.full !== b.name ? ` <span class="small muted">(${esc(b.full)})</span>` : ""}</h3>
      <div class="row mt-s">${b.lobs?.length ? b.lobs.map((l) => `<span class="chip plain">${esc(l)}</span>`).join("") : `<span class="chip plain">All LOBs</span>`}${(b.when || []).map((w) => `<span class="chip teal">${esc(WHEN_NAME[w] || w)}</span>`).join("")}${b.active ? "" : `<span class="chip warn">Retired</span>`}</div></div>
      ${editable ? `<div class="row">${b.active ? `<button class="btn ghost sm" data-up ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button class="btn ghost sm" data-down ${i === n - 1 ? "disabled" : ""} aria-label="Move down">↓</button>` : ""}<button class="btn sm" data-edit>Edit</button><button class="btn ghost sm" data-toggle>${b.active ? "Retire" : "Bring back"}</button></div>` : ""}</div>
    <p>${esc(b.desc)}</p>
    <div class="grid g2 mt"><div><span class="eyebrow">How to do it on the call</span><ol class="small steps-ol">${(b.how || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
      <div><span class="eyebrow">Sounds like</span>${(b.sounds_list || []).length ? `<div class="sugg mt-s">${b.sounds_list.map((x) => `<button type="button" tabindex="-1">“${esc(x)}”</button>`).join("")}</div>` : ""}
        ${(b.avoid || []).length ? `<span class="eyebrow mt">Avoid</span>${ul(b.avoid)}` : ""}</div></div>
    <details class="mt"><summary class="small"><b>Why it matters, actions for commitments, what to listen for</b></summary>
      <div class="grid g2 mt"><div><span class="eyebrow">Why it matters</span><p class="small">${esc(b.driver || "—")}</p><p class="small"><b>Moves:</b> ${(b.kpis || []).map((k) => esc(KPI_NAME[k] || k)).join(", ") || "—"}</p>
        ${(b.keywords || []).length ? `<p class="small muted"><b>Survey words that point to it:</b> ${b.keywords.map(esc).join(", ")}</p>` : ""}</div>
      <div><span class="eyebrow">On-call actions for SMART commitments</span>${ul(b.actions)}<span class="eyebrow">Supervisors listen for</span>${ul(b.listen_for)}</div></div></details>
  </div>`;
}

export async function page(main, _p, ctx) {
  const { api, toast, go, state } = ctx;
  const info = await api("GET", "/api/behaviors");
  setBank(info);
  const editable = info.editable;
  const mine = editable ? info.behaviors : info.behaviors.filter((b) => b.active && (!b.lobs?.length || !state.user.lob || state.user.lob === "All" || b.lobs.includes(state.user.lob)));
  const active = mine.filter((b) => b.active).sort((a, b) => a.position - b.position), retired = mine.filter((b) => !b.active);
  main.innerHTML = head(editable ? "Behavior bank" : "Our behaviors",
    editable ? `The behaviors your supervisors coach, and how you want each one done on the call. Supervisors and agents only see the active ones for their LOB, and the AI follows what you write here.`
      : `The behaviors your team coaches${info.manager ? `, set by ${esc(info.manager.name)}` : ""}, and how each one should sound on the call.`,
    editable ? `<button class="btn primary" id="add">+ Add a behavior</button>` : "") +
    `${editable ? `<p class="small muted">${active.length} active of ${info.max_active} max · keep the list short: supervisors coach one behavior at a time.</p>` : ""}
    <div class="stack mt">${active.map((b, i) => card(b, editable, i, active.length)).join("")}</div>
    ${editable && retired.length ? `<details class="mt2"><summary><b>Retired (${retired.length})</b> <span class="small muted">· hidden from pickers, kept in history</span></summary><div class="stack mt">${retired.map((b, i) => card(b, editable, i, retired.length)).join("")}</div></details>` : ""}`;
  if (!editable) return;
  const reload = () => go("bank");
  $("#add", main).onclick = () => editor(null, { api, toast, onSaved: reload });
  $$(".bcard", main).forEach((el) => {
    const key = el.dataset.key, b = info.behaviors.find((x) => x.id === key);
    $("[data-edit]", el).onclick = () => editor(b, { api, toast, onSaved: reload });
    $("[data-toggle]", el).onclick = async () => {
      try { await api("POST", `/api/behaviors/${encodeURIComponent(key)}/active`, { active: !b.active }); toast(b.active ? `${b.name} retired. It stays in past coaching.` : `${b.name} is back.`); reload(); }
      catch (e) { toast(e.message, "err"); }
    };
    const move = async (d) => {
      const keys = active.map((x) => x.id), i = keys.indexOf(key);
      [keys[i], keys[i + d]] = [keys[i + d], keys[i]];
      try { await api("POST", "/api/behaviors/order", { keys }); reload(); } catch (e) { toast(e.message, "err"); }
    };
    const up = $("[data-up]", el), down = $("[data-down]", el);
    if (up) up.onclick = () => move(-1);
    if (down) down.onclick = () => move(1);
  });
}

// One list item per line in a textarea.
const lines = (v) => (v || []).join("\n");
const split = (v) => String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);

function editor(b, { api, toast, onSaved }) {
  const d = b || { name: "", full: "", desc: "", lobs: [], when: [], how: [], sounds_list: [], avoid: [], driver: "", kpis: [], keywords: [], actions: [], listen_for: [] };
  let aiDrafted = !!b?.ai_drafted;
  const m = modal(`<h3>${b ? `Edit ${esc(b.name)}` : "Add a behavior"}</h3>
    <p class="small muted mt">Write it the way you want it done on your calls. Not sure where to start? Type the name and a sentence, then click <b>Suggest with AI</b> and edit what it drafts.</p>
    <form id="bf" class="bform mt">
      <div class="fgrid"><label class="f">Name<input class="in" name="name" maxlength="60" required value="${esc(d.name)}" placeholder="e.g. Warm Transfer"></label>
        <label class="f">Long name <small class="muted">(optional)</small><input class="in" name="full" maxlength="80" value="${esc(d.full && d.full !== d.name ? d.full : "")}"></label>
        <label class="f wide">What it is<textarea class="in" name="desc" rows="2" maxlength="400" placeholder="One sentence: what the agent does">${esc(d.desc)}</textarea></label>
        <label class="f wide">Your notes for the AI <small class="muted">(optional, not saved: anything about how you want it done)</small><textarea class="in" name="notes" rows="2" maxlength="800" placeholder="e.g. On BVA calls we always confirm the callback number before the transfer"></textarea></label></div>
      <div class="row mt"><button type="button" class="btn ai" id="suggest">Suggest with AI</button><span id="ai-tag"></span></div>
      <fieldset class="checks-row mt"><legend class="f">Lines of business</legend>${LOBS.map((l) => `<label class="ck"><input type="checkbox" name="lob" value="${l}" ${d.lobs?.includes(l) ? "checked" : ""}> ${l}</label>`).join("")}<span class="small muted">None ticked = every LOB</span></fieldset>
      <fieldset class="checks-row mt"><legend class="f">When in the call</legend>${WHEN.map((w) => `<label class="ck"><input type="checkbox" name="when" value="${w.id}" ${d.when?.includes(w.id) ? "checked" : ""}> ${w.name}</label>`).join("")}</fieldset>
      <div class="fgrid mt">
        <label class="f wide">How to do it on the call <small class="muted">(one step per line, in order)</small><textarea class="in" name="how" rows="4">${esc(lines(d.how))}</textarea></label>
        <label class="f">What it sounds like <small class="muted">(lines the agent can say, one per line)</small><textarea class="in" name="sounds" rows="4">${esc(lines(d.sounds_list))}</textarea></label>
        <label class="f">Avoid <small class="muted">(one per line)</small><textarea class="in" name="avoid" rows="4">${esc(lines(d.avoid))}</textarea></label>
        <label class="f wide">Why it matters <small class="muted">(the member complaint it prevents)</small><input class="in" name="driver" maxlength="300" value="${esc(d.driver)}"></label>
      </div>
      <fieldset class="checks-row mt"><legend class="f">KPIs it moves</legend>${KPIS.map((k) => `<label class="ck"><input type="checkbox" name="kpi" value="${k.id}" ${d.kpis?.includes(k.id) ? "checked" : ""}> ${esc(k.name)}</label>`).join("")}</fieldset>
      <div class="fgrid mt">
        <label class="f">On-call actions for SMART commitments <small class="muted">(one per line)</small><textarea class="in" name="actions" rows="4">${esc(lines(d.actions))}</textarea></label>
        <label class="f">What supervisors listen for <small class="muted">(one per line)</small><textarea class="in" name="listen_for" rows="4">${esc(lines(d.listen_for))}</textarea></label>
        <label class="f wide">Survey words that point to it <small class="muted">(comma-separated; helps PULSE read member comments)</small><input class="in" name="keywords" value="${esc((d.keywords || []).join(", "))}"></label>
      </div>
      <div class="spread mt2"><span class="small muted" id="bf-msg"></span><span class="row"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" id="save">${b ? "Save changes" : "Add to the bank"}</button></span></div>
    </form>`);
  m.el.querySelector(".modal").classList.add("wide-modal");
  const f = $("#bf", m.el);
  const val = (n) => f.elements[n]?.value || "";
  const checked = (n) => $$(`input[name=${n}]:checked`, f).map((x) => x.value);
  const collect = () => ({
    name: val("name"), full: val("full"), desc: val("desc"), notes: val("notes"), lobs: checked("lob"), when: checked("when"), how: split(val("how")), sounds: split(val("sounds")),
    avoid: split(val("avoid")), driver: val("driver"), kpis: checked("kpi"), actions: split(val("actions")), listen_for: split(val("listen_for")),
    keywords: val("keywords").split(",").map((x) => x.trim()).filter(Boolean), ai_drafted: aiDrafted,
  });
  $("#suggest", m.el).onclick = async (e) => {
    const draft = collect();
    if (draft.name.trim().length < 2) { toast("Write the behavior’s name first.", "err"); f.elements.name.focus(); return; }
    e.target.disabled = true; $("#ai-tag", m.el).innerHTML = `<span class="small muted">Drafting…</span>`;
    try {
      const s = await api("POST", "/api/behaviors/suggest", { draft, key: b?.id });
      const set = (n, v) => { if (v != null && f.elements[n]) f.elements[n].value = v; };
      if (s.desc && !draft.desc.trim()) set("desc", s.desc);
      if (s.full && !draft.full.trim() && s.full !== draft.name) set("full", s.full);
      set("how", lines(s.how)); set("sounds", lines(s.sounds)); set("avoid", lines(s.avoid)); set("driver", s.driver || draft.driver);
      set("actions", lines(s.actions)); set("listen_for", lines(s.listen_for)); set("keywords", (s.keywords || []).join(", "));
      if (Array.isArray(s.when) && s.when.length) $$("input[name=when]", f).forEach((x) => (x.checked = s.when.includes(x.value)));
      if (Array.isArray(s.kpis) && s.kpis.length) $$("input[name=kpi]", f).forEach((x) => (x.checked = s.kpis.includes(x.value)));
      aiDrafted = s.source === "ai";
      $("#ai-tag", m.el).innerHTML = `${sourceTag(s)} <span class="small muted">Review and edit it before saving.</span>`;
    } catch (err) { $("#ai-tag", m.el).innerHTML = ""; toast(err.message, "err"); }
    e.target.disabled = false;
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = collect(); delete body.notes;
    $("#save", m.el).disabled = true;
    try {
      if (b) await api("PUT", `/api/behaviors/${encodeURIComponent(b.id)}`, body); else await api("POST", "/api/behaviors", body);
      m.close(); toast(b ? "Saved. Supervisors see the change right away." : "Added to the bank."); onSaved();
    } catch (err) { $("#bf-msg", m.el).textContent = err.message; $("#save", m.el).disabled = false; }
  };
}
