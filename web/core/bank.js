// Behavior bank: each manager owns the list of behaviors their supervisors coach, and how each one should be done on
// the call. A manager's bank starts as a copy of PULSE's 7 core behaviors and can be edited, extended, tagged by LOB
// and retired. Records (commitments, sessions, roleplays…) store the behavior's key, so history keeps working.
import { BEHAVIORS as BASE, KPIS, LOBS } from "./constants.js";

export const WHEN = [
  { id: "opening", name: "Opening" }, { id: "discovery", name: "Discovery and verification" }, { id: "resolution", name: "Resolution" },
  { id: "hold", name: "Holds and transfers" }, { id: "close", name: "Close" }, { id: "whole", name: "The whole call" },
];
export const MAX_ACTIVE = 20;

// The manager's "how to do it on the call" for the 7 core behaviors, used when a bank is first created.
const EXTRAS = {
  lara: {
    when: ["discovery", "resolution"],
    how: ["Let the member finish without interrupting.", "Acknowledge what they said in one sentence, using their words.", "Respond to that exact point, in plain language.", "Ask a check question to confirm it landed."],
    sounds_list: ["So the claim from your March visit was denied and nobody told you why. Let me pull it up.", "Did that answer your question?"],
    avoid: ["Talking over the member to get to the account faster.", "Reading plan codes or terms without explaining them."],
    listen_for: ["The member never has to repeat the issue.", "A one-sentence restatement before researching.", "A check question after the answer."],
  },
  ownership: {
    when: ["resolution", "hold"],
    how: ["Say you’ll take care of it before researching.", "Stay on the line while you check instead of transferring.", "If a transfer is needed, warm-transfer with a full summary.", "Confirm the fix before closing."],
    sounds_list: ["Let me take care of that for you. I’ll stay on the line while I check that claim."],
    avoid: ["“That’s not our department.”", "Cold transfers or asking the member to call someone else."],
    listen_for: ["“I’ll take care of…” in the first minute of the issue.", "No cold transfer.", "The agent confirms the fix before closing."],
  },
  expectations: {
    when: ["resolution", "close"],
    how: ["Say what happens next.", "Give when: a date or a range of business days.", "Say what the member needs to do, if anything.", "Give a reference number and what to do if nothing arrives."],
    sounds_list: ["Your payment posts in 2 business days. If you don’t see it by Thursday, call us and mention this reference."],
    avoid: ["“It’s in process.”", "“Soon” or “it depends” without a range."],
    listen_for: ["A date or business-day range.", "What the member does next.", "A reference number and a fallback."],
  },
  needs: {
    when: ["discovery", "close"],
    how: ["Ask what prompted the call before jumping into the account.", "Check the account for related open items.", "Before closing, ask one open question about what’s coming up (appointments, refills, bills)."],
    sounds_list: ["Besides the ID card, is anything coming up, like a refill or an appointment, that I can help you get ready for?"],
    avoid: ["“Anything else?” followed by the closing in the same breath."],
    listen_for: ["An open question about upcoming needs before closing.", "The agent raises a related open item on the account."],
  },
  warm: {
    when: ["opening", "whole"],
    how: ["Greet with energy and offer help in the first 5 seconds.", "Use the member’s name at least twice.", "Keep a friendly tone through the whole call, not just the opening."],
    sounds_list: ["Good morning, Mrs. Alvarez! Happy to help with that."],
    avoid: ["Going straight to “member ID?”", "A flat, scripted tone."],
    listen_for: ["Name used at least twice.", "An offer to help in the opening."],
  },
  appreciation: {
    when: ["hold", "close"],
    how: ["Ask before placing on hold and say why.", "Thank the member by name after every hold.", "Close by thanking them for their time and for being with the plan."],
    sounds_list: ["Thank you for holding while I checked that. I know your time matters."],
    avoid: ["Long silences while searching.", "Holds without asking."],
    listen_for: ["A thank-you after every hold.", "No silence longer than a few seconds without explaining."],
  },
  empathy: {
    when: ["discovery", "resolution"],
    how: ["Acknowledge the feeling first, tied to the member’s situation.", "Then move to action: say what you’ll do now.", "On denials and bills, use one empathy line before explaining."],
    sounds_list: ["I can hear how stressful this denial is. Let’s work through it together."],
    avoid: ["Jumping to the process right after the member says they’re upset.", "Generic “I apologize for the inconvenience.”"],
    listen_for: ["An empathy line tied to what the member said.", "Action right after the empathy line."],
  },
};

const list = (v, max, len) => (Array.isArray(v) ? v : String(v || "").split(/\n+/)).map((x) => String(x ?? "").replace(/\s+/g, " ").trim().replace(/^[-•*\d.)\s]+/, "").slice(0, len)).filter(Boolean).slice(0, max);
const text = (v, len) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, len);
const soundsText = (arr) => arr.map((s) => `“${s.replace(/^“|”$/g, "")}”`).join(" … ");

// A stored row (or a built-in behavior) → the shape the rest of PULSE uses: id = the key records store.
export function normalize(row) {
  const extras = EXTRAS[row.key || row.id] || {};
  const sounds_list = Array.isArray(row.sounds_list) ? row.sounds_list : Array.isArray(row.sounds) ? row.sounds : extras.sounds_list || (row.sounds ? [String(row.sounds).replace(/[“”]/g, "")] : []);
  return {
    id: row.key || row.id, row_id: row.key ? row.id : null, manager_id: row.manager_id || null,
    name: row.name, full: row.full_name || row.full || row.name, desc: row.description ?? row.desc ?? "",
    when: row.when_in_call || row.when || extras.when || [], how: row.how || extras.how || [],
    sounds_list, sounds: soundsText(sounds_list), avoid: row.avoid || extras.avoid || [],
    driver: String(row.driver || "").replace(/^Dissatisfier:\s*/i, ""), kpis: row.kpis || [], keywords: row.keywords || [],
    actions: row.actions || [], listen_for: row.listen_for || extras.listen_for || [],
    lobs: row.lobs || [], active: row.active !== false, position: row.position ?? 0, ai_drafted: !!row.ai_drafted,
    updated_at: row.updated_at || null,
  };
}

export const DEFAULT_BEHAVIORS = BASE.map((b, i) => normalize({ ...b, position: i }));
export const DEFAULT_BY_ID = Object.fromEntries(DEFAULT_BEHAVIORS.map((b) => [b.id, b]));

// Rows to insert when a manager's bank is created.
export const defaultRows = (managerId) => DEFAULT_BEHAVIORS.map((b, i) => ({
  manager_id: managerId, key: b.id, name: b.name, full_name: b.full, description: b.desc, when_in_call: b.when, how: b.how, sounds: b.sounds_list, avoid: b.avoid,
  driver: b.driver, kpis: b.kpis, keywords: b.keywords, actions: b.actions, listen_for: b.listen_for, lobs: [], active: true, position: i,
}));

export const byKey = (behaviors) => Object.fromEntries(behaviors.map((b) => [b.id, b]));
// Behaviors a person can work with: active, and either for every LOB or tagged with theirs.
export const forLob = (behaviors, lob) => behaviors.filter((b) => b.active && (!b.lobs?.length || !lob || lob === "All" || b.lobs.includes(lob))).sort((a, b) => a.position - b.position);

export const newKey = (name) => `${String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "behavior"}-${Math.random().toString(36).slice(2, 6)}`;

// Checks what the manager wrote. Returns { row } (the fields to store, with database column names) or { problem }.
// (desc, when and full are SQL keywords, so they're stored as description, when_in_call and full_name.)
export function cleanBehavior(input = {}) {
  const name = text(input.name, 60);
  if (name.length < 2) return { problem: "Give the behavior a name." };
  const desc = text(input.desc, 400);
  if (desc.length < 10) return { problem: "Describe the behavior in a sentence." };
  const how = list(input.how, 8, 220);
  if (!how.length) return { problem: "Add at least one step for how to do it on the call." };
  const sounds = list(input.sounds ?? input.sounds_list, 6, 260).map((s) => s.replace(/^["“]|["”]$/g, ""));
  if (!sounds.length) return { problem: "Add at least one line of what it sounds like." };
  const actions = list(input.actions, 6, 220);
  if (!actions.length) return { problem: "Add at least one on-call action supervisors can use for commitments." };
  const kpis = (Array.isArray(input.kpis) ? input.kpis : []).filter((k) => KPIS.some((x) => x.id === k));
  if (!kpis.length) return { problem: "Pick at least one KPI it moves." };
  const when = (Array.isArray(input.when) ? input.when : []).filter((w) => WHEN.some((x) => x.id === w));
  return {
    row: {
      name, full_name: text(input.full, 80) || name, description: desc, how, when_in_call: when.length ? when : ["whole"], sounds, avoid: list(input.avoid, 6, 220),
      driver: text(input.driver, 300).replace(/^Dissatisfier:\s*/i, ""), kpis,
      keywords: list(input.keywords, 20, 40).map((k) => k.toLowerCase()), actions, listen_for: list(input.listen_for, 6, 220),
      lobs: (Array.isArray(input.lobs) ? input.lobs : []).filter((l) => LOBS.includes(l)),
    },
  };
}

// The manager's standard for one behavior, written out for the AI.
export function behaviorContext(b) {
  if (!b) return "";
  const whenNames = (b.when || []).map((w) => WHEN.find((x) => x.id === w)?.name).filter(Boolean).join(", ");
  return [
    `${b.name}: ${b.desc}`,
    b.how?.length ? `How the manager wants it done on the call${whenNames ? ` (${whenNames})` : ""}: ${b.how.map((s, i) => `${i + 1}) ${s}`).join(" ")}` : "",
    b.sounds_list?.length ? `Sounds like: ${b.sounds_list.map((s) => `"${s}"`).join(" | ")}` : "",
    b.avoid?.length ? `Avoid: ${b.avoid.join("; ")}` : "",
    b.driver ? `Why it matters (the member complaint it prevents): ${b.driver}` : "",
    b.listen_for?.length ? `What supervisors listen for: ${b.listen_for.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
