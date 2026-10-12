// AI features for PULSE. Each function tries the AI provider first (Gemini on the server)
// and falls back to rule-based output, so the app keeps working without a key or over the free limit.
import { ROOT_CAUSES, ROOT_CAUSE_BY_ID, TOOLS, TOOL_NAMES, SESSION_TYPES, TOOL_PLAN, DIRECT_STEPS, KPI_BY_ID, PROGRAM, CALL_TYPES } from "./constants.js";
import { redact } from "./util.js";
import { scoreBehaviors } from "./services.js";
import { deliveryMetrics, deliveryLine } from "./delivery.js";
import { DEFAULT_BEHAVIORS, byKey, behaviorContext } from "./bank.js";

// The system prompt lists the behaviors of this team's bank (set by their manager).
export const systemFor = (behaviors = DEFAULT_BEHAVIORS) => `You are PULSE, a coaching assistant for contact center supervisors at a BPO serving a US health insurance client (lines of business: Medicare Supplement, BVA, IFM, NPG).
Purpose: ${PROGRAM.purpose}
Coaching model DIRECT: ${DIRECT_STEPS.map((s) => `${s.id} = ${s.name} (${s.desc})`).join("; ")}.
The core behaviors this team coaches, set by their manager (every commitment uses exactly one, by id): ${behaviors.map((b) => `${b.id} = ${b.name}: ${b.desc}${b.driver ? ` (prevents: ${b.driver})` : ""}`).join(" | ")}.
Root causes: ${ROOT_CAUSES.map((r) => `${r.id} = ${r.name}: ${r.sign}`).join(" | ")}.
Coaching tools: ${TOOLS.map((t) => `${t.name}: ${t.desc}`).join(" | ")}.
Weekly rhythm per agent: Setting Goals and Skill Transfer on Monday–Tuesday, Monitor on Wednesday–Thursday, Kudos/Accountability on Friday.
SMART commitments are on-call actions the agent can be heard doing, in the agent's own words, with a number of calls, how it's checked, and a follow-up date. KPI results (CSAT, NPS, FCR, AHT) are never the commitment.
Satisfiers members reward: ownership, plain-language explanations, clear next steps, first-contact resolution, acknowledging health or money stress. Dissatisfiers: calling again, transfers, holds and dead air, jargon, broken callbacks, feeling rushed, a "no" with no explanation.
Quality bar: be specific to this agent and this call. Cite their actual numbers, quote their actual verbatims or transcript lines, and write lines an agent could say word for word on a US health insurance call. No generic advice ("be more empathetic", "improve communication"), no filler, no repeating the question back.
Rules: write in clear, peer-to-peer English. Use only fictional member names. Never invent member data, IDs or medical details beyond what the scenario needs. Return only valid JSON when JSON is requested.`;
export const SYSTEM = systemFor();

const idList = (behaviors) => behaviors.map((b) => b.id).join("|");
const rcIds = ROOT_CAUSES.map((r) => r.id).join("|");

// Models don't always return clean JSON: strip thinking, code fences and any text around the object.
export function parseJSON(text) {
  const clean = String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(clean); } catch {}
  const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1));
  throw new Error("The AI didn’t return JSON");
}

// "Groq · gpt-oss-120b": shown on everything the AI makes, so people know which model wrote it.
const PROVIDER_NAMES = { gemini: "Gemini", groq: "Groq", nvidia: "NVIDIA", ollama: "Ollama (local)" };
export function aiLabel(provider, model) {
  const p = PROVIDER_NAMES[provider] || provider || "AI";
  const m = String(model || "").split("/").pop();
  return m ? `${p} · ${m}` : p;
}

async function ask(provider, prompt, { temperature = 0.4, history = null, fast = false, effort = null, behaviors = DEFAULT_BEHAVIORS } = {}) {
  if (!provider) return null;
  try {
    const messages = history ? [...history, { role: "user", text: prompt }] : [{ role: "user", text: prompt }];
    const req = { system: systemFor(behaviors), messages, json: true, temperature, fast, effort };
    const started = Date.now();
    const text = await provider.generate(req);
    if (!text) return null;
    const r = parseJSON(text);
    if (r && typeof r === "object") {
      const by = req.answeredBy || { provider: provider.name, model: provider.stats?.lastModel || provider.model };
      r.ai_by = aiLabel(by.provider, by.model);
      r.ai_ms = Date.now() - started;
    }
    return r;
  } catch (e) {
    if (provider.onError) provider.onError(e);
    return null;
  }
}

function kpiLines(summary) {
  if (!summary) return "No KPI data.";
  return Object.entries(summary.kpis).map(([k, v]) => `${KPI_BY_ID[k].name}: ${v.value ?? "n/a"}${KPI_BY_ID[k].unit} (goal ${v.goal}, prior 4 weeks ${v.prev ?? "n/a"}, ${v.onGoal ? "on goal" : "below goal"})`).join("; ");
}
const verbLines = (vs) => vs.slice(0, 12).map((v) => `- (${v.score ?? "?"}/10) ${redact(v.text)}`).join("\n") || "- none";
const histLines = (cs, BY) => cs.slice(0, 5).map((c) => `- week ${c.week_start}: ${BY[c.behavior]?.name || c.behavior}, root cause ${c.root_cause}, action "${c.action}", result ${c.status}${c.monitor_total ? ` (${c.monitor_hits}/${c.monitor_total})` : ""}`).join("\n") || "- none";

// ---------- 1. Identify the behavior to coach ----------
// supervisor (optional): { pick, reason, calls: ["one line per call"], tally: { top } } — the supervisor's own diagnosis.
// The AI first decides from the data on its own, then gives a second opinion on the supervisor's pick.
export async function diagnose(provider, { agent, summary, verbatims, history, supervisor = null, behaviors = DEFAULT_BEHAVIORS }) {
  const BY = byKey(behaviors), ids = idList(behaviors);
  const ranked = scoreBehaviors(summary, verbatims, behaviors);
  const sup = supervisor && BY[supervisor.pick] ? supervisor : null;
  const prompt = `Identify the ONE core behavior this supervisor should coach this week.
Agent (fictional): first name ${agent.name.split(" ")[0]}, LOB ${agent.lob}.
KPIs (4-week average): ${kpiLines(summary)}
Recent survey verbatims:
${verbLines(verbatims)}
Previous commitments:
${histLines(history, BY)}
Rule-based ranking for reference: ${ranked.slice(0, 3).map((r) => `${r.id} (${r.score})`).join(", ")}.${sup ? `
THE SUPERVISOR'S OWN DIAGNOSIS (they listened to the calls; you didn't):
${(sup.calls || []).map((l) => `- ${l}`).join("\n")}
Most-missed behavior in their calls: ${sup.tally?.top && BY[sup.tally.top] ? BY[sup.tally.top].name : "none marked"}.
Their pick: ${BY[sup.pick].name}. Their reason: "${redact(String(sup.reason || "")).slice(0, 600)}"
First decide from the KPIs, verbatims and history on your own ("behavior_id"). Then give a second opinion on their pick: treat what they heard on calls as strong evidence, say plainly where the data supports or challenges it, and never just agree to be polite.` : ""}
Return JSON: {"behavior_id":"${ids}","confidence":"high|medium|low",${sup ? '"agrees_with_supervisor":true,"comparison":"2 sentences: where the data and their call evidence support or challenge their pick","check_next":"one thing to listen for on the next calls to settle it",' : ""}"why":"2 sentences tying KPI -> driver (satisfier/dissatisfier) -> behavior","driver":"the member-side driver in plain words","kpi_link":"which KPI it moves and how","evidence":["3 short evidence bullets quoting data or verbatims"],"root_cause_hypothesis":{"id":"${rcIds}","why":"what to confirm in the session"},"secondary_behavior_id":"${ids}","listen_for":["4 observable things to listen for in 3-5 calls"],"questions_to_ask":["3 open self-discovery questions for the E step"]}`;
  const r = await ask(provider, prompt, { temperature: 0.3, behaviors });
  if (r && BY[r.behavior_id]) {
    const out = { ...r, behavior_name: BY[r.behavior_id].name, ranking: ranked, source: "ai" };
    if (r.secondary_behavior_id && !BY[r.secondary_behavior_id]) delete out.secondary_behavior_id;
    if (sup) out.agrees_with_supervisor = r.agrees_with_supervisor === true || r.agrees_with_supervisor === "true" || r.behavior_id === sup.pick;
    return out;
  }
  const off = diagnoseOffline({ agent, summary, verbatims, history, ranked, BY });
  return sup ? { ...off, ...secondOpinionOffline(off, sup, ranked, BY) } : off;
}

// Without AI: compare the supervisor's pick with the rule-based ranking of KPIs and verbatims.
function secondOpinionOffline(off, sup, ranked, BY) {
  const pos = ranked.findIndex((x) => x.id === sup.pick);
  const agrees = sup.pick === off.behavior_id || pos === 1;
  const name = BY[sup.pick].name;
  return {
    agrees_with_supervisor: agrees,
    comparison: agrees
      ? `The KPIs and verbatims point the same way: ${name} ranks ${pos === 0 ? "first" : "second"} in the data${sup.tally?.top === sup.pick ? ", and it was the most-missed behavior in your calls" : ""}.`
      : `The data points more to ${off.behavior_name}; ${name} ranks ${pos + 1} of ${ranked.length} in the KPIs and verbatims. Your calls are the stronger evidence if what you heard was clear.`,
    check_next: agrees ? `On the next calls, confirm the moment ${name} is missing (opening, middle or close).` : `On the next 2 calls, listen for both ${name} and ${off.behavior_name} and note which one the member reacts to.`,
  };
}

function diagnoseOffline({ summary, history, ranked, BY }) {
  const top = ranked[0], b = BY[top.id], second = BY[ranked[1]?.id] || b;
  const k = (summary?.critical || [])[0];
  const prev = (history || []).find((c) => c.behavior === b.id);
  const rc = prev && prev.status === "partial" ? "skill" : prev && prev.status === "not_met" ? "will" : "skill";
  return {
    behavior_id: b.id, behavior_name: b.name, confidence: top.evidence.length >= 2 ? "high" : top.evidence.length ? "medium" : "low",
    why: `${k ? KPI_BY_ID[k].name + " is below goal" : "KPIs are close to goal"}, and the negative verbatims point to this: ${b.driver.replace(/^Dissatisfier: /, "").toLowerCase()} That lines up with ${b.name}.`,
    driver: b.driver.replace(/^Dissatisfier: /, ""), kpi_link: `${b.name} mainly moves ${b.kpis.map((x) => KPI_BY_ID[x].name).join(", ")}.`,
    evidence: [...top.evidence.slice(0, 2), k ? `${KPI_BY_ID[k].name}: ${summary.kpis[k].value} vs. goal ${summary.kpis[k].goal}` : "No KPI below goal"].filter(Boolean),
    root_cause_hypothesis: { id: rc, why: prev ? `Last time this behavior was ${prev.status.replace("_", " ")}. Confirm whether the agent knows the steps or struggles to apply them live.` : "Confirm with the 5 Whys: does the agent know what to say, and can they do it under pressure?" },
    secondary_behavior_id: second.id,
    listen_for: b.listen_for?.length ? [...b.listen_for.slice(0, 3), "Whether the member has to ask the same thing twice"] : [b.actions[0], "Whether the member has to ask the same thing twice", "What the member hears in the last 30 seconds of the call", "How the agent handles the moment the member gets frustrated"],
    questions_to_ask: ["What do you think the member needed to hear at that point?", "If you took this call again, what would you do differently?", "What gets in the way of doing that on busy days?"],
    ranking: ranked, source: "offline",
  };
}

// ---------- 2. Strategy: tools per session, DIRECT guide, SMART draft ----------
export async function strategy(provider, { agent, behaviorId, rootCause, summary, verbatims, behaviors = DEFAULT_BEHAVIORS }) {
  const b = byKey(behaviors)[behaviorId], rc = ROOT_CAUSE_BY_ID[rootCause] || ROOT_CAUSE_BY_ID.skill;
  const prompt = `Build this week's coaching plan.
Agent (fictional): ${agent.name.split(" ")[0]}, LOB ${agent.lob}. Behavior: ${b.name}. Root cause: ${rc.name}.
THE MANAGER'S STANDARD FOR THIS BEHAVIOR (follow it: use their steps and example lines, and build the SMART draft from their on-call actions):
${behaviorContext(b)}
Their on-call actions: ${b.actions.join(" | ")}
KPIs: ${kpiLines(summary)}
Verbatims:
${verbLines(verbatims || [])}
Allowed tools (use these exact names): ${TOOL_NAMES.join(", ")}.
Return JSON: {"tools":{"setting_goals":{"tool":"","how":"1-2 sentences"},"skill_transfer":{"tool":"","how":""},"monitor":{"tool":"","how":""},"kudos_accountability":{"tool":"","how":""}},"direct":{"D":{"say":["2 lines"],"avoid":["1 line"]},"I":{"say":[],"avoid":[]},"R":{"say":[],"avoid":[]},"E":{"say":[],"avoid":[]},"C":{"say":[],"avoid":[]},"T":{"say":[],"avoid":[]}},"smart_draft":{"action":"on-call action in the agent's words, first person","measure_target":5,"measure_total":5,"check_method":"how and when it is checked"},"practice":["2 practice ideas for Skill Transfer"]}`;
  const r = await ask(provider, prompt, { temperature: 0.5, behaviors });
  if (r && r.tools && r.direct && r.smart_draft) {
    Object.keys(r.tools).forEach((k) => { if (!TOOL_NAMES.includes(r.tools[k]?.tool)) r.tools[k] = { tool: TOOL_PLAN[rc.id][k], how: r.tools[k]?.how || "" }; });
    return { ...r, source: "ai" };
  }
  return strategyOffline(b, rc);
}

function strategyOffline(b, rc) {
  const plan = TOOL_PLAN[rc.id];
  const howFor = (tool) => TOOLS.find((t) => t.name === tool)?.how || "";
  return {
    tools: Object.fromEntries(SESSION_TYPES.map((t) => [t.id, { tool: plan[t.id], how: howFor(plan[t.id]) }])),
    direct: {
      D: { say: ["How’s your week going? Anything on the floor getting in your way?"], avoid: ["“Let’s get into your numbers.”"] },
      I: { say: [`Today we’re focusing on ${b.name}. Last time you committed to something. How did it go?`, "Here’s what one member wrote in a survey. Let’s keep that member in mind."], avoid: ["Playing the call before saying why you’re there."] },
      R: { say: ["On that call you verified the member quickly and stayed calm. That’s what members notice."], avoid: ["“Good call, but…”"] },
      E: { say: ["What do you think the member needed to hear at that point?", "If you took this call again, what would you change?"], avoid: ["“You should have…”"] },
      C: { say: [rc.id === "knowledge" ? "Walk me through the steps. Where are you unsure?" : rc.id === "will" ? "What gets in the way of doing it on every call?" : rc.id === "tool_process" ? "Where does the system slow you down?" : "You know what to say. What makes it hard in the moment?"], avoid: ["“You just need more training.”"] },
      T: { say: ["What will you do on your calls this week? Say it in your words.", "How will we both know it happened? Let’s check Wednesday and Thursday, and review Friday."], avoid: ["Writing the plan for them."] },
    },
    smart_draft: { action: `I will ${b.actions[0].charAt(0).toLowerCase() + b.actions[0].slice(1)}`.replace(/\.$/, " on every call this week."), measure_target: 5, measure_total: 5, check_method: `${plan.monitor}, 5 calls on Wed–Thu` },
    practice: [`Role-play two ${b.name} moments with an upset member.`, `${plan.skill_transfer}: ${howFor(plan.skill_transfer)}`],
    source: "offline",
  };
}

// ---------- 3. Auto-generated quiz ----------
export async function quiz(provider, { behaviorId, agent, summary, count = 5, focus = "", behaviors = DEFAULT_BEHAVIORS }) {
  const b = byKey(behaviors)[behaviorId];
  focus = redact(String(focus || "").trim()).slice(0, 300);
  // The supervisor's focus leads: every question is built around it. Without one, the behavior's usual opportunity is used.
  const prompt = `Write a ${count}-question multiple-choice quiz for a contact center agent (fictional name ${agent?.name?.split(" ")[0] || "the agent"}, LOB ${agent?.lob || "health insurance"}) on the core behavior ${b.name}: ${b.desc}
${focus ? `THE SUPERVISOR'S FOCUS (most important): "${focus}"
Every question must test this focus directly: set each question in the exact call situation, step or skill it describes, and use the words it uses. Do not add questions about other topics. If the focus names a call type, every question happens on that call type. The title must name the focus.
Background only: ${b.name} usually fixes this member complaint: ${b.driver}.` : `Opportunity: ${b.driver}.
Use realistic health insurance call moments (claim status, benefits, eligibility, billing, ID cards, denials).`}
THE MANAGER'S STANDARD FOR THIS BEHAVIOR (right answers follow it; wrong answers break it or match the "avoid" list):
${behaviorContext(b)}
KPIs (context only): ${kpiLines(summary)}.
Each question has 4 options and exactly one correct option. The wrong options must be clearly worse for a coach (vague, KPI-focused, rushed, jargon, blaming), not equally good.
Put the correct option's exact text in "answer" (copied word for word from "o").
Return JSON: {"title":"short title","questions":[{"q":"","o":["","","",""],"answer":"exact text of the correct option","why":"one sentence on why it is correct"}]}`;
  const r = await ask(provider, prompt, { temperature: focus ? 0.5 : 0.6, behaviors });
  const questions = r && normalizeQuiz(r.questions);
  if (questions) return { ...r, questions, behavior: behaviorId, focus, source: "ai" };
  return { ...quizOffline(b, count, Math.random, behaviors), focus, focus_used: false }; // the built-in questions can't be tailored
}

// Models (small local ones especially) often get the answer's position wrong, so they give the answer's text and
// PULSE finds it. Options are shuffled so the right answer isn't always A. ai_a keeps the AI's pick: the supervisor confirms it.
const norm = (t) => String(t ?? "").toLowerCase().replace(/^[a-d][).:\s]+/i, "").replace(/[^a-z0-9]+/g, " ").trim();
export function normalizeQuiz(list, rand = Math.random) {
  if (!Array.isArray(list) || !list.length) return null;
  const out = [];
  for (const x of list) {
    const o = (Array.isArray(x?.o) ? x.o : Array.isArray(x?.options) ? x.options : []).map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, 4);
    const q = String(x?.q ?? x?.question ?? "").trim();
    if (!q || o.length < 2) continue;
    let a = -1;
    if (x.answer != null) {
      const want = norm(x.answer);
      a = o.findIndex((t) => norm(t) === want);
      if (a < 0 && /^[a-d]$/i.test(String(x.answer).trim())) a = "abcd".indexOf(String(x.answer).trim().toLowerCase());
      if (a < 0 && want.length >= 8) a = o.findIndex((t) => { const n = norm(t); return n.length >= 8 && (n.includes(want) || want.includes(n)); });
    }
    if (a < 0 && Number.isInteger(x.a) && x.a >= 0 && x.a < o.length) a = x.a;
    const order = o.map((_, i) => [i, rand()]).sort((p, n) => p[1] - n[1]).map(([i]) => i);
    const shuffled = order.map((i) => o[i]);
    const at = a >= 0 ? order.indexOf(a) : null;
    out.push({ q, o: shuffled, a: at, ai_a: at, why: String(x.why ?? "").trim() });
  }
  return out.length ? out : null;
}

export function quizOffline(b, count, rand = Math.random, behaviors = DEFAULT_BEHAVIORS) {
  const others = behaviors.filter((x) => x.id !== b.id);
  const wrongLines = [...(b.avoid || []).map((x) => x.replace(/^“|”$/g, "")), "“You’ll need to call another department.”", "“It’s in process.”", "“Hold on.”"];
  const shuffleWith = (correct, wrong) => {
    const opts = [correct, ...wrong.slice(0, 3)];
    const order = opts.map((_, i) => [i, rand()]).sort((x, y) => x[1] - y[1]).map(([i]) => i);
    return { o: order.map((i) => opts[i]), a: order.indexOf(0) };
  };
  const qs = [
    { q: `Which line best shows ${b.name}?`, ...shuffleWith(`“${(b.sounds_list?.[0] || b.sounds).replace(/^“|”$/g, "")}”`, wrongLines.map((x) => (x.startsWith("“") ? x : `“${x}”`))), why: b.desc },
    { q: `Which of these is an on-call action for ${b.name}, not a KPI result?`, ...shuffleWith(b.actions[0], ["Raise my CSAT to 90%.", "Be more positive.", "Hit 92% FCR this week."]), why: "A commitment is something you can be heard doing on a call." },
    ...(b.driver && others.filter((o) => o.driver).length >= 3 ? [{ q: `Which member experience does ${b.name} prevent?`, ...shuffleWith(b.driver, others.filter((o) => o.driver).map((o) => o.driver)), why: `That’s the dissatisfier ${b.name} removes.` }] : []),
    { q: "When does your supervisor check whether the committed action is happening on your calls?", ...shuffleWith("Wednesday–Thursday, in the Monitor session", ["Only at the end of the month", "When QA scores a call", "Never, it’s self-reported"]), why: "Monitor happens Wednesday–Thursday so Friday’s Kudos/Accountability is based on evidence." },
    { q: `Which commitment for ${b.name} is SMART?`, ...shuffleWith(`“${b.actions[0].replace(/\.$/, "")}, on 5 of 5 calls. We check Wed–Thu and review Friday.”`, [`“I’ll work on ${b.name}.”`, "“I’ll improve my NPS.”", "“I’ll try harder.”"]), why: "Specific action, a number, how it’s checked and when." },
    ...(b.how?.length && others.filter((o) => o.how?.length).length >= 3 ? [{ q: `Which step is part of how ${b.name} is done on the call?`, ...shuffleWith(b.how[0], others.filter((o) => o.how?.length).map((o) => o.how[0])), why: `Your team’s steps for ${b.name}: ${b.how.join(" ")}` }] : []),
  ];
  return { title: `${b.name}: quick check`, questions: qs.slice(0, Math.max(3, Math.min(count, qs.length))), behavior: b.id, source: "offline" };
}

// ---------- 4. AI-simulated roleplay ----------
export async function roleplayStart(provider, { behaviorId, callType, difficulty = "medium", channel = "text", behaviors = DEFAULT_BEHAVIORS }) {
  const b = byKey(behaviors)[behaviorId];
  const prompt = `Create a roleplay scenario. The AI will play a fictional health insurance member calling the contact center; the human plays the agent and is practicing ${b.name} (${b.desc}).
THE MANAGER'S STANDARD FOR THIS BEHAVIOR (design the call so these moments come up, and write the success criteria from their steps and what supervisors listen for):
${behaviorContext(b)}
Call type: ${callType || CALL_TYPES[0]}. Difficulty: ${difficulty}.${channel === "voice" ? " This is a voice call: the member's lines will be read aloud by text-to-speech, so write the opening as natural spoken words only (no stage directions, brackets or emojis)." : ""}
Make it feel like a real call on this line of business: concrete fictional details (dates, dollar amounts, provider or pharmacy names, what the member already tried), a believable reason to be upset, and a hidden need that is related but different.
"member_notes" tells the actor how this member talks and what they know, so they stay consistent through the call.
Return JSON: {"member_name":"fictional full name","member_gender":"female|male","member_age":65,"situation":"2 sentences the agent can see before the call","mood":"calm|worried|frustrated|angry","opening":"the member's first line, in character, 1-2 sentences","hidden_need":"a related need the member only mentions if asked","member_notes":"one sentence on how they talk (pace, words they use, what sets them off) + the 2-3 concrete details they know","success_criteria":["3 observable things the agent should do for ${b.name}, each something you could hear on the call"]}`;
  const r = await ask(provider, prompt, { temperature: 0.8, behaviors });
  if (r && r.opening && r.member_name) return { ...r, member_gender: r.member_gender === "male" ? "male" : "female", member_age: clampAge(r.member_age), opening: spoken(r.opening, channel), member_notes: String(r.member_notes || "").slice(0, 400), behavior: behaviorId, call_type: callType, difficulty, channel, source: "ai" };
  return { ...roleplayStartOffline(b, callType, difficulty), channel };
}

const clampAge = (a) => (Number.isFinite(+a) ? Math.max(25, Math.min(95, Math.round(+a))) : 66);
// Text-to-speech reads everything literally, so strip stage directions, markdown and emojis from spoken lines.
export const spoken = (t, channel) => channel !== "voice" ? t : String(t || "").replace(/\*[^*]{0,60}\*|\[[^\]]{0,60}\]|\([^)]{0,40}(sigh|pause|laugh|angr|frustrat|tone|beat)[^)]{0,40}\)/gi, " ").replace(/[*_#`~]/g, "").replace(/\p{Extended_Pictographic}/gu, "").replace(/\s{2,}/g, " ").trim();

export const SCRIPTS = {
  "Claim status": { name: "Gloria Méndez", gender: "female", age: 71, situation: "Member calling for the third time about a specialist claim from last month. She has no letter yet.", opening: "Hi, this is my third time calling about the same claim and nobody can tell me anything.", lines: ["So is it paid or not? I just need a straight answer.", "And when will I actually know? Last time they said ‘soon.’", "Okay… what do I do if I don’t get anything by then?"], need: "She also has a follow-up visit next week and wants to know if it needs authorization." },
  "Benefits question": { name: "Robert Haines", gender: "male", age: 67, situation: "Member asking what he will pay for an MRI next week. He doesn’t understand deductible vs. coinsurance.", opening: "My doctor wants an MRI next Tuesday. How much is this going to cost me?", lines: ["What does ‘after deductible’ even mean?", "So in dollars, roughly what am I looking at?", "Okay, is there anything I need to do before the appointment?"], need: "He also takes a monthly prescription that is running out." },
  "Eligibility": { name: "Teresa Blanco", gender: "female", age: 65, situation: "New member whose pharmacy says her coverage isn’t active.", opening: "The pharmacy just told me I don’t have coverage. I paid my first premium!", lines: ["I need my medication today. What am I supposed to do?", "How long until the pharmacy sees it?", "Should I call the pharmacy or will you?"], need: "She hasn’t received her ID card either." },
  "Billing / premium": { name: "Frank Delgado", gender: "male", age: 74, situation: "Member’s premium went up and an autopay was taken twice this month.", opening: "You charged me twice this month and my premium went up. What is going on?", lines: ["When do I get my money back?", "Why did the premium go up in the first place?", "Will this happen again next month?"], need: "He wants to change his payment date to after his pension deposit." },
  "ID card": { name: "Linda Shaw", gender: "female", age: 69, situation: "Member lost her ID card and has a doctor’s appointment tomorrow morning.", opening: "I lost my insurance card and I see my doctor tomorrow morning. Can you help?", lines: ["How long will the new one take?", "But what do I show the doctor tomorrow?", "Can you send it to my new address?"], need: "She moved last month and her address may be outdated." },
  "Claim denial": { name: "Victor Ramos", gender: "male", age: 58, situation: "Member’s claim for an emergency visit was denied. He’s worried about the bill.", opening: "I got a letter saying my ER claim was denied. I can’t afford this bill.", lines: ["Why was it denied? The letter is just codes.", "So what are my options now?", "How long does an appeal take, and what do I do with the bill meanwhile?"], need: "He was hospitalized overnight and expects a second bill." },
};

function roleplayStartOffline(b, callType, difficulty) { // success criteria come from the manager's listen-for list when there is one
  const s = SCRIPTS[callType] || SCRIPTS["Claim status"];
  return { member_name: s.name, member_gender: s.gender, member_age: s.age, situation: s.situation, mood: difficulty === "hard" ? "angry" : "frustrated", opening: s.opening, hidden_need: s.need, success_criteria: b.listen_for?.length >= 2 ? b.listen_for.slice(0, 3) : [b.actions[0], b.actions[1] || "Confirm the member understood before closing.", "Close with the next step and the timeline."], behavior: b.id, call_type: callType || "Claim status", difficulty, source: "offline" };
}

export async function roleplayTurn(provider, { scenario, transcript }) {
  const history = transcript.map((m) => ({ role: m.who === "agent" ? "user" : "model", text: m.who === "agent" ? `AGENT: ${m.text}` : JSON.stringify({ reply: m.text }) }));
  const prompt = `Stay in character as ${scenario.member_name}, the member (${scenario.member_age || 66} years old). Situation: ${scenario.situation} Mood: ${scenario.mood}. Hidden need (only reveal if the agent asks about anything else or other needs): ${scenario.hidden_need || "none"}.${scenario.member_notes ? `
How this member talks and what they know (follow it): ${scenario.member_notes}` : ""}
How to play the member (follow all of these):
- You are the caller, not the helper. Never solve your own problem, never explain insurance rules, never coach the agent, and never say what the agent "should" do.
- Talk like a real ${scenario.member_age || 66}-year-old on the phone: short, plain sentences, sometimes a half sentence; react to what the agent just said, not to the whole call. 1-2 sentences, 3 at most.
- Stay consistent: keep the same names, dates and amounts; don't invent new problems (only the hidden need, and only if the agent asks whether there's anything else).
- Mood moves one step at a time. Calm down only when the agent shows they get it AND gives a concrete next step or date. Get more upset with vague answers ("it's in process"), jargon, a hold without asking, being rushed or transferred, or a "no" with no reason. Thank the agent only when they've earned it.
- If the agent asks you to verify, give fictional details (a made-up member ID, date of birth, address) and keep them the same.
- If the agent explains something in jargon, ask what it means. If they give a timeline, repeat it back or ask what happens if it doesn't arrive.
- End the call (end=true) only when the agent has closed with a next step and you have nothing else, or after about 8 of your turns.
Good reply: "Okay... so it'll be paid by the 20th? And if it's not, I just call you back?" Bad reply (too helpful, too long): "I understand you're doing your best, and I appreciate your help in resolving this claim issue today. Could you please clarify the expected processing time?"${scenario.channel === "voice" ? `
This is a phone call. Your reply is read aloud by text-to-speech, so write only the words ${scenario.member_name.split(" ")[0]} says: natural spoken English with contractions, no lists, no emojis, no stage directions or brackets. A ${scenario.member_age || 66}-year-old member may ask the agent to repeat or slow down if they talk fast or use jargon. The agent's words come from speech recognition: ignore missing punctuation and obvious mis-hearings; if a line is truly unclear, ask the agent to repeat it, like a real caller would.${lastInterrupted(transcript) ? " The agent just talked over you before you finished. React to that briefly, as a real caller would." : ""}` : ""}
Return JSON: {"reply":"","mood":"calm|worried|frustrated|angry","end":false}`;
  if (provider) {
    const r = await ask(provider, prompt, { temperature: 0.85, fast: true, history: [{ role: "user", text: `SCENARIO START. Member opening: ${scenario.opening}` }, ...history] });
    if (r && r.reply) return { ...r, reply: spoken(r.reply, scenario.channel), source: "ai" };
  }
  const s = Object.values(SCRIPTS).find((x) => x.name === scenario.member_name) || SCRIPTS[scenario.call_type] || SCRIPTS["Claim status"];
  const need = scenario.hidden_need || s.need;
  const memberTurns = transcript.filter((m) => m.who === "member").length;
  const lastAgent = [...transcript].reverse().find((m) => m.who === "agent")?.text.toLowerCase() || "";
  if (need && /anything else|other (question|need)|is there something|upcoming|refill|appointment/.test(lastAgent) && !transcript.some((m) => m.text === `Actually, yes. ${need}`)) return { reply: `Actually, yes. ${need}`, mood: "worried", end: false, source: "offline" };
  if (memberTurns - 1 < s.lines.length) return { reply: s.lines[memberTurns - 1], mood: memberTurns > 2 ? "worried" : scenario.mood, end: false, source: "offline" };
  return { reply: "Okay. Thank you, that helps. I think that’s everything.", mood: "calm", end: true, source: "offline" };
}

const lastInterrupted = (t) => !!t.at(-1)?.voice?.interrupted;

export const CUES = {
  lara: /(so (you|your)|make sure i|just to confirm|did that answer|does that make sense|in other words|let me make sure)/i,
  ownership: /(i('| wi)ll take care|let me (take care|fix|check|handle)|i('| wi)ll stay|i('| wi)ll make sure|i('| a)m going to)/i,
  expectations: /(\d+\s*(to\s*\d+\s*)?(business )?days|by (monday|tuesday|wednesday|thursday|friday)|next step|you('| wi)ll (get|receive|see)|reference)/i,
  needs: /(anything else|other (question|concern)|upcoming|refill|appointment|what prompted|is there something)/i,
  warm: /(happy to|good (morning|afternoon)|glad to|my pleasure|absolutely)/i,
  appreciation: /(thank you|thanks for|appreciate)/i,
  empathy: /(i understand how|i('| a)m sorry|that sounds (stressful|frustrating|hard)|i can (hear|imagine)|that must be)/i,
};

export async function roleplayEvaluate(provider, { scenario, transcript, behaviors = DEFAULT_BEHAVIORS }) {
  const b = byKey(behaviors)[scenario.behavior] || byKey(DEFAULT_BEHAVIORS)[scenario.behavior] || behaviors[0];
  const delivery = deliveryMetrics(transcript);
  const text = transcript.map((m) => `${m.who.toUpperCase()}: ${m.text}`).join("\n");
  const prompt = `Evaluate the agent's performance in this practice call on the core behavior ${b.name} (${b.desc}).
Judge it against THE MANAGER'S STANDARD for this behavior:
${behaviorContext(b)}
Success criteria: ${(scenario.success_criteria || []).join("; ")}.
Transcript:
${text}${delivery ? `
This was a voice call; the agent's lines come from speech recognition, so don't judge spelling or punctuation. ${deliveryLine(delivery)}
Give one "delivery_tip" about how the agent sounded (pace, silences, talking over the member), tied to ${b.name} when you can.` : ""}
Score with this scale: 5 = ${b.name} clearly shown at the right moments and no dissatisfiers; 4 = shown well with one small miss; 3 = shown once or only partly; 2 = mostly missing, or undone by a dissatisfier (vague answer, jargon, unasked hold, rushed close); 1 = absent. Judge only what is in the transcript.
Check each success criterion: "met" only if you can quote the agent line that shows it.
"did_well" and "improve" must quote or point to specific agent lines. "model_lines" must fit THIS call (use the member's situation and details), said the way an agent would say them.
Return JSON: {"score":1-5,"summary":"2 sentences","criteria":[{"text":"the criterion","met":true,"evidence":"short quote of the agent's line, or what was missing"}],"did_well":["2-3 specific quotes or moments"],"improve":["2-3 specific changes"],"model_lines":["2 better lines the agent could have said"],"behavior_seen":true,"other_behaviors":["names of other core behaviors shown"]${delivery ? ',"delivery_tip":"one sentence"' : ""}}`;
  const r = await ask(provider, prompt, { temperature: 0.2, behaviors });
  if (r && r.score) {
    const score = Math.max(1, Math.min(5, Math.round(Number(r.score)) || 1));
    const criteria = Array.isArray(r.criteria) ? r.criteria.filter((c) => c && c.text).slice(0, 6).map((c) => ({ text: String(c.text), met: c.met === true || c.met === "true", evidence: String(c.evidence || "") })) : null;
    return { ...r, score, criteria, delivery, source: "ai" };
  }
  return evaluateOffline(scenario, transcript, behaviors);
}

// Phrases that show a behavior: the built-in cues for the 7, or the first words of the manager's example lines.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function cueFor(b) {
  if (CUES[b.id]) return CUES[b.id];
  const bits = (b.sounds_list || []).map((l) => l.replace(/[“”"]/g, "").split(/[,.!?]/)[0].trim().split(/\s+/).slice(0, 4).join(" ")).filter((x) => x.split(" ").length >= 2);
  return bits.length ? new RegExp(`(${bits.map(esc).join("|")})`, "i") : /$^/;
}

const WEAK_LINES = [
  [/it[’']?s in process/i, "Replace “It’s in process” with what is happening and when the member will hear back."],
  [/\bhold on\b/i, "Ask before a hold and say why: “May I place you on a brief hold while I check that?”"],
  [/you[’']?(d| would)? (have|need) to call|call back for that/i, "Own it instead of sending the member to call someone else."],
  [/it depends/i, "Give a range and a date instead of “it depends.”"],
  [/that[’']?s the policy/i, "Explain the reason behind the rule in plain words."],
  [/^okay,? bye\.?$|\bokay,? bye\b/i, "Close with the next step and the timeline before saying goodbye."],
];

// Rule-based scoring: listens for the phrases each behavior sounds like. Used when no AI answers, and for sample data.
export function evaluateOffline(scenario, transcript, behaviors = DEFAULT_BEHAVIORS) {
  const BY = { ...byKey(DEFAULT_BEHAVIORS), ...byKey(behaviors) };
  const b = BY[scenario.behavior] || behaviors[0];
  const delivery = deliveryMetrics(transcript);
  const agentText = transcript.filter((m) => m.who === "agent").map((m) => m.text).join(" ");
  const seen = behaviors.filter((x) => cueFor(x).test(agentText)).map((x) => x.id);
  const main = seen.includes(b.id);
  const others = seen.filter((x) => x !== b.id).length;
  // Phrases members dislike take points off, and so do long silences and talking over the member.
  const weak = WEAK_LINES.filter(([re]) => re.test(agentText));
  const penalty = Math.min(2, weak.length) + (delivery?.dead_air >= 2 ? 1 : 0) + (delivery?.interruptions ? 1 : 0);
  const score = Math.max(1, Math.min(5, (main ? 3 : 1) + (others >= 4 ? 2 : others >= 2 ? 1 : 0) - penalty));
  const fixes = weak.map(([, tip]) => tip);
  return {
    score, summary: main ? `${b.name} showed up in this call. ${score >= 4 ? "Strong practice." : penalty ? "But lines members dislike (or long silences) pulled the score down: see what to try next time." : "Keep building the other behaviors around it."}` : `${b.name} didn’t come through clearly in this call. Try the model lines below on the next run.`,
    did_well: seen.length ? seen.map((id) => `You showed ${BY[id].name}.`) : ["You stayed on the call and kept it moving."],
    improve: [
      ...fixes.slice(0, 1),
      main ? (seen.includes("expectations") && b.id !== "expectations" ? "Give the next step and the date one at a time, then check the member understood." : "Close with the next step and the timeline before saying goodbye.") : b.actions[0],
      !seen.includes("needs") ? "Ask if the member has anything else coming up before closing." : !seen.includes("empathy") ? "Acknowledge the member’s stress before jumping into the fix." : "Keep the same energy through the close; it’s what the member remembers.",
    ].slice(0, 3),
    model_lines: [(b.sounds_list?.[0] || b.sounds).replace(/^“|”$/g, ""), "Before we hang up: is there anything else coming up, like an appointment or a refill?"],
    behavior_seen: main, other_behaviors: seen.filter((x) => x !== b.id).map((id) => BY[id].name),
    delivery, delivery_tip: delivery?.notes[0] || undefined, source: "offline",
  };
}

// ---------- Behavior bank: the AI drafts a behavior for the manager to edit ----------
// draft: what the manager has so far (at least a name). Returns suggested fields; nothing is saved.
export async function suggestBehavior(provider, { draft = {}, behaviors = DEFAULT_BEHAVIORS }) {
  const name = String(draft.name || "").trim().slice(0, 60);
  const others = behaviors.filter((b) => b.name !== name).map((b) => b.name).join(", ");
  const has = (k) => (Array.isArray(draft[k]) ? draft[k].filter(Boolean).length : String(draft[k] || "").trim().length);
  const prompt = `A contact center manager is defining a behavior their supervisors will coach agents on, for US health insurance calls (${(draft.lobs || []).length ? draft.lobs.join(", ") : "all lines of business"}).
Behavior name: "${name}"${draft.desc ? `\nWhat the manager means by it: ${redact(String(draft.desc)).slice(0, 400)}` : ""}${draft.notes ? `\nThe manager's notes on how they want it done: ${redact(String(draft.notes)).slice(0, 800)}` : ""}
${["how", "sounds", "avoid", "actions", "listen_for", "driver"].some(has) ? `What they wrote so far (keep their wording and intent; fill the gaps and sharpen it): ${JSON.stringify({ how: draft.how, sounds: draft.sounds, avoid: draft.avoid, driver: draft.driver, actions: draft.actions, listen_for: draft.listen_for })}` : ""}
Other behaviors already in their bank (don't overlap with them): ${others || "none"}.
Write it so a supervisor could coach it and hear it on a call: concrete steps in call order, lines an agent could say word for word, on-call actions that can be counted on 5 calls (never a KPI result).
Return JSON: {"full":"long name if any","desc":"one sentence: what the agent does","when":["opening|discovery|resolution|hold|close|whole"],"how":["3-5 steps, in order"],"sounds":["2-3 example lines"],"avoid":["2-3 phrases or habits to avoid"],"driver":"the member complaint it prevents, in the member's words","kpis":["nps|csat|fcr|aht|qa"],"keywords":["6-10 words or short phrases members write in surveys when it's missing"],"actions":["3 on-call actions for SMART commitments, first person optional"],"listen_for":["3-4 things a supervisor can hear on a call"]}`;
  const r = await ask(provider, prompt, { temperature: 0.5, behaviors });
  if (r && Array.isArray(r.how) && r.how.length) return { ...r, source: "ai" };
  return {
    desc: draft.desc || "", when: ["whole"], how: draft.how?.length ? draft.how : [`Say it the way the team agreed for ${name || "this behavior"}.`, "Do it at the moment it fits in the call, not as a script line.", "Check the member understood before moving on."],
    sounds: draft.sounds?.length ? draft.sounds : [], avoid: draft.avoid || [], driver: draft.driver || "", kpis: ["nps", "csat"], keywords: [],
    actions: draft.actions?.length ? draft.actions : [`Use ${name || "the behavior"} on every call this week, in my own words.`], listen_for: draft.listen_for || [], source: "offline",
  };
}

// ---------- 5. Friday review assistant ----------
export async function review(provider, { agent, commitment, sessions, behaviors = DEFAULT_BEHAVIORS }) {
  const b = byKey(behaviors)[commitment.behavior] || byKey(DEFAULT_BEHAVIORS)[commitment.behavior] || { name: commitment.behavior, actions: [commitment.action] };
  const held = sessions.filter((s) => s.status === "held").map((s) => s.type).join(", ") || "none";
  const prompt = `Help the supervisor run Friday's Kudos/Accountability with ${agent.name.split(" ")[0]}.
Behavior: ${b.name}. Commitment: "${commitment.action}". Target: ${commitment.measure_target} of ${commitment.measure_total} calls. Monitor result: ${commitment.monitor_hits ?? "not recorded"} of ${commitment.monitor_total ?? commitment.measure_total}. Agent self-log: ${commitment.self_hits ?? 0} calls. Sessions held this week: ${held}.
Return JSON: {"outcome":"met|partial|not_met","kudos":"what to recognize, specific","accountability":"what to say about the gap, if any","next_step":"keep, raise the bar, change the tool, or re-diagnose, with one sentence why","next_week_action":"suggested on-call action for next week"}`;
  const r = await ask(provider, prompt, { temperature: 0.4, effort: "low", behaviors });
  if (r && r.outcome) return { ...r, source: "ai" };
  const hits = commitment.monitor_hits, total = commitment.monitor_total || commitment.measure_total;
  const outcome = hits == null ? "partial" : hits >= commitment.measure_target ? "met" : hits >= Math.ceil(total / 2) ? "partial" : "not_met";
  return {
    outcome,
    kudos: hits ? `In ${hits} of ${total} calls you did it: “${commitment.action}” That’s the behavior members notice.` : "Recognize the effort you saw in Skill Transfer.",
    accountability: outcome === "met" ? "No gap this week. Ask what made it work." : !sessions.some((s) => s.type === "monitor" && s.status === "held") ? "Monitor wasn’t held, so there’s no evidence yet. Listen to calls before deciding." : `It happened in ${hits ?? 0} of ${total}. Ask what got in the way on the others.`,
    next_step: outcome === "met" ? "Keep it one more week, then raise the bar or move to the next behavior." : outcome === "partial" ? "Keep the behavior and adjust the plan or tool." : "Go back to the root cause. Not met twice means re-diagnose.",
    next_week_action: outcome === "met" ? (b.actions[1] || b.actions[0]) : commitment.action, source: "offline",
  };
}
