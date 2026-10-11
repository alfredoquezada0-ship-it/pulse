// PULSE program constants. Shared by the browser and the Node backend.

export const PROGRAM = {
  name: "PULSE",
  tagline: "Coaching intelligence for contact center supervisors",
  purpose:
    "Help supervisors know who to coach, on which behavior, how to coach it, and whether it worked, " +
    "using the DIRECT model, the 7 core behaviors, weekly SMART commitments and the weekly coaching rhythm.",
};

export const LOBS = ["MedSupp", "BVA", "IFM", "NPG"];

// KPI definitions. Goals are defaults; managers can edit them per LOB.
export const KPIS = [
  { id: "nps", name: "MES NPS", unit: "", dir: "higher", goal: 36, min: -100, max: 100 },
  { id: "csat", name: "CSAT", unit: "%", dir: "higher", goal: 90, min: 0, max: 100 },
  { id: "fcr", name: "DD FCR", unit: "%", dir: "higher", goal: 92, min: 0, max: 100 },
  { id: "aht", name: "AHT", unit: "s", dir: "lower", goal: 600, min: 0, max: 1800 },
  { id: "qa", name: "Quality", unit: "%", dir: "higher", goal: 90, min: 0, max: 100 },
];
export const KPI_BY_ID = Object.fromEntries(KPIS.map((k) => [k.id, k]));

// The 7 core behaviors. Keywords help the offline diagnosis match survey verbatims.
export const BEHAVIORS = [
  {
    id: "lara", name: "LARA", full: "Listen, Acknowledge, Respond, Ask",
    desc: "Listen fully, acknowledge what the member said, respond to it, then ask to confirm it landed.",
    sounds: "“So the claim from your March visit was denied and nobody told you why. Let me pull it up.” … “Did that answer your question?”",
    driver: "Dissatisfier: members repeat themselves, feel unheard, or don’t understand the answer.",
    kpis: ["csat", "nps", "fcr"],
    keywords: ["didn't listen", "not listening", "repeat", "didn't understand", "confusing", "explain", "jargon", "codes", "talked over", "interrupt", "didn't answer"],
    actions: ["Restate the member’s issue in one sentence before researching.", "After answering, ask ‘Did that answer your question?’", "Translate plan terms and codes into plain language with the member’s own numbers."],
  },
  {
    id: "ownership", name: "Take Ownership", full: "Take Ownership",
    desc: "Own the issue until it’s resolved or properly handed off.",
    sounds: "“Let me take care of that for you. I’ll stay on the line while I check that claim.”",
    driver: "Dissatisfier: transfers, being bounced around, “not my department.”",
    kpis: ["fcr", "nps", "csat"],
    keywords: ["transfer", "department", "bounced", "passed around", "nobody helped", "not my", "call back", "callback", "never called"],
    actions: ["Stay on the line during the claim check instead of transferring.", "Warm-transfer with a full summary so the member never repeats the issue.", "Say ‘I’ll take care of that for you’ and confirm the fix before closing."],
  },
  {
    id: "expectations", name: "Set Clear Expectations", full: "Set Clear Expectations",
    desc: "Tell the member what happens next, when, and what they need to do.",
    sounds: "“Your payment posts in 2 business days. If you don’t see it by Thursday, call us and mention this reference.”",
    driver: "Dissatisfier: having to call again, “nobody told me,” vague timelines.",
    kpis: ["fcr", "nps", "csat"],
    keywords: ["call again", "called again", "third time", "second time", "nobody told", "didn't know when", "no idea what", "next step", "how long", "still waiting", "never got"],
    actions: ["Before closing, tell the member what happens next and by when.", "Give the delivery window and what to do in the meantime.", "Give a reference number and what to do if nothing arrives."],
  },
  {
    id: "needs", name: "Discover Needs", full: "Discover Needs",
    desc: "Ask questions to find the real need behind the call, including what the member didn’t mention.",
    sounds: "“Besides the ID card, is anything coming up, like a refill or an appointment, that I can help you get ready for?”",
    driver: "Dissatisfier: a second call about the thing the member didn’t ask the first time.",
    kpis: ["fcr", "nps"],
    keywords: ["other question", "also needed", "before i could ask", "didn't ask", "rushed", "hung up", "couldn't finish", "other bill", "another issue"],
    actions: ["Ask one open question about upcoming appointments or refills before closing.", "Ask ‘What prompted the call today?’ before jumping into the account.", "Check the account for related open items and raise them."],
  },
  {
    id: "warm", name: "Be Warm & Friendly", full: "Be Warm & Friendly",
    desc: "Sound like a person, not a script: tone, the member’s name, a smile you can hear.",
    sounds: "“Good morning, Mrs. Alvarez! Happy to help with that.”",
    driver: "Dissatisfier: cold, robotic or rude calls.",
    kpis: ["csat", "nps"],
    keywords: ["rude", "cold", "robot", "scripted", "attitude", "unfriendly", "short with me", "annoyed", "tone"],
    actions: ["Greet with the member’s name and an offer to help in the first 5 seconds.", "Use the member’s name at least twice during the call."],
  },
  {
    id: "appreciation", name: "Show Appreciation", full: "Show Appreciation",
    desc: "Thank the member for their time, patience and loyalty, and mean it.",
    sounds: "“Thank you for holding while I checked that. I know your time matters.”",
    driver: "Dissatisfier: feeling like a ticket number; long holds with no thanks.",
    kpis: ["csat", "nps"],
    keywords: ["hold", "on hold", "waited", "wait", "silence", "dead air", "forever", "ticket number", "didn't thank", "unappreciated"],
    actions: ["Thank the member by name after every hold.", "Close by thanking the member for being with the plan."],
  },
  {
    id: "empathy", name: "Demonstrate Empathy", full: "Demonstrate Empathy",
    desc: "Show you understand how the situation feels, then move to action.",
    sounds: "“I can hear how stressful this denial is. Let’s work through it together.”",
    driver: "Dissatisfier: “they didn’t care,” especially on denials, bills and health stress.",
    kpis: ["nps", "csat"],
    keywords: ["didn't care", "care", "frustrat", "stress", "upset", "cancer", "hospital", "surgery", "bill", "denied", "denial", "no sympathy", "cold"],
    actions: ["When the member shares a frustration, acknowledge the feeling before moving to the fix.", "On every denial call, use one empathy line tied to the member’s situation."],
  },
];
export const BEHAVIOR_BY_ID = Object.fromEntries(BEHAVIORS.map((b) => [b.id, b]));

export const ROOT_CAUSES = [
  { id: "knowledge", name: "Knowledge", sign: "Doesn’t know the policy, the process or what good sounds like.", tools: ["Fast Ball Quizzes", "Model Tape", "Discuss"] },
  { id: "skill", name: "Skill", sign: "Knows it, but the delivery slips: rushed, robotic or inconsistent under pressure.", tools: ["Self Tape vs. Model", "SBS", "Self Tape"] },
  { id: "will", name: "Will", sign: "Knows it, can do it, doesn’t do it. Often shows up only when someone is listening.", tools: ["Setting Expectations", "Discuss"] },
  { id: "tool_process", name: "Tool/Process", sign: "The system or the process gets in the way: slow screens, broken steps, outdated job aids.", tools: ["SBS", "Discuss"] },
];
export const ROOT_CAUSE_BY_ID = Object.fromEntries(ROOT_CAUSES.map((r) => [r.id, r]));

export const TOOLS = [
  { id: "SBS", name: "SBS", full: "Side-by-side", desc: "Sit with the agent on live calls and coach between calls.", how: "Listen to 2–3 calls. Give one tip after each, then try it on the next call." },
  { id: "Remote Call Listening", name: "Remote Call Listening", desc: "Listen to live or recorded calls without sitting next to the agent.", how: "Pick 3–5 calls of the target type. Score only the committed action." },
  { id: "Fast Ball Quizzes", name: "Fast Ball Quizzes", desc: "Quick 3–5 question quizzes on process or policy.", how: "Ask 3 rapid questions at the desk or in chat. Correct on the spot." },
  { id: "Setting Expectations", name: "Setting Expectations", desc: "A clear conversation about the standard, why it matters and what happens next.", how: "State the standard, show the evidence, agree on the action, confirm understanding." },
  { id: "Discuss", name: "Discuss", desc: "A two-way conversation built on open questions, the DIRECT way.", how: "Ask what happened, why, and what they’d do differently. Then wait." },
  { id: "Self Tape vs. Model", name: "Self Tape vs. Model", desc: "The agent hears their own call next to a model call and compares.", how: "Play 30 seconds of each at the same moment. Ask: “What’s different?”" },
  { id: "Self Tape", name: "Self Tape", desc: "The agent listens to their own call and assesses it.", how: "Play the key moment. Ask: “What did the member hear?”" },
  { id: "Model Tape", name: "Model Tape", desc: "The agent listens to a strong call by a peer.", how: "Play the model moment. Ask: “What made that work?”" },
];
export const TOOL_NAMES = TOOLS.map((t) => t.name);

// The weekly coaching rhythm. days = ISO weekday numbers (1 = Monday).
export const SESSION_TYPES = [
  { id: "setting_goals", name: "Setting Goals", days: [1, 2], window: "Mon–Tue", desc: "Pick one behavior, mark the root cause, and agree on the on-call action with the agent." },
  { id: "skill_transfer", name: "Skill Transfer", days: [1, 2], window: "Mon–Tue", desc: "Teach and practice the on-call action until the agent can do it." },
  { id: "monitor", name: "Monitor", days: [3, 4], window: "Wed–Thu", desc: "Listen to calls and count whether the action is happening." },
  { id: "kudos_accountability", name: "Kudos/Accountability", days: [5], window: "Fri", desc: "Recognize it if the commitment was met. If not, hold the line and adjust the plan." },
];
export const SESSION_TYPE_BY_ID = Object.fromEntries(SESSION_TYPES.map((s) => [s.id, s]));

// Suggested tool per session type and root cause.
export const TOOL_PLAN = {
  knowledge: { setting_goals: "Discuss", skill_transfer: "Fast Ball Quizzes", monitor: "Remote Call Listening", kudos_accountability: "Discuss" },
  skill: { setting_goals: "Self Tape", skill_transfer: "Self Tape vs. Model", monitor: "SBS", kudos_accountability: "Self Tape" },
  will: { setting_goals: "Setting Expectations", skill_transfer: "Discuss", monitor: "Remote Call Listening", kudos_accountability: "Setting Expectations" },
  tool_process: { setting_goals: "Discuss", skill_transfer: "SBS", monitor: "SBS", kudos_accountability: "Discuss" },
};

export const DIRECT_STEPS = [
  { id: "D", name: "Develop Rapport", desc: "Build connection and trust before talking performance." },
  { id: "I", name: "Indicate Focus", desc: "State the purpose before reviewing the call, and recall the last commitment or score." },
  { id: "R", name: "Reinforce / Recognize", desc: "Recognize improvement and reinforce good behaviors. There is always a bright side." },
  { id: "E", name: "Engage in Self-Discovery", desc: "Don’t tell, ask. Socratic questions so the agent finds the gap." },
  { id: "C", name: "Cause of Gap", desc: "Find the root cause and choose the right action plan for this agent." },
  { id: "T", name: "Tweak & Timeline", desc: "Agree on the goal and plan together: a SMART commitment and a follow-up date." },
];

export const CALL_TYPES = ["Claim status", "Benefits question", "Eligibility", "Billing / premium", "ID card", "Claim denial"];

export const COMMITMENT_STATUS = [
  { id: "open", name: "Open" },
  { id: "met", name: "Met" },
  { id: "partial", name: "Partially met" },
  { id: "not_met", name: "Not met" },
];

// Quartile labels from the NPS quadrant model (equal groups by MES NPS rank).
export const QUARTILES = [
  { id: "top", name: "Top", action: "Replicate and recognize" },
  { id: "on_goal", name: "On goal", action: "Individual plan toward Top" },
  { id: "bottom", name: "Bottom", action: "Plan toward On goal" },
  { id: "outlier", name: "Outlier", action: "Same root cause work, more intensive" },
];

export const GUIDES = [
  { id: "direct", title: "Coaching with DIRECT", file: "guides/coaching-with-direct.html", minutes: 35, desc: "Run a complete coaching session with the six DIRECT steps: what to say and what to avoid.", roles: ["supervisor", "manager"] },
  { id: "behavior", title: "Coaching the Right Behavior", file: "guides/coaching-the-right-behavior.html", minutes: 40, desc: "Pick the one behavior worth coaching, from KPI to driver to behavior.", roles: ["supervisor", "manager"] },
  { id: "five_whys", title: "Root Cause with the 5 Whys", file: "guides/root-cause-5-whys.html", minutes: 35, desc: "DIRECT step C: get from a symptom to a root cause you can act on.", roles: ["supervisor", "manager"] },
  { id: "weekly", title: "Weekly SMART Commitments", file: "guides/weekly-smart-commitments.html", minutes: 40, desc: "The weekly rhythm, the 8 coaching tools and SMART commitments on the 7 core behaviors.", roles: ["supervisor", "manager", "agent"] },
];

// ---------- Manager → supervisor coaching ----------
// The six supervisor behaviors. PULSE measures each one from the coaching data the supervisor already keeps.
export const SUP_BEHAVIORS = [
  { id: "rhythm", name: "Holds the weekly rhythm", short: "Weekly rhythm",
    desc: "Every agent gets Setting Goals and Skill Transfer Mon–Tue, Monitor Wed–Thu and Kudos/Accountability Fri, marked on time.",
    measure: "Sessions held, of those due this week",
    actions: ["I’ll hold Monitor for every agent by Thursday and mark it the same day", "I’ll block 30 minutes each morning to mark yesterday’s sessions", "I’ll plan the four sessions for every agent by Monday at noon"] },
  { id: "direct", name: "Coaches with DIRECT", short: "DIRECT",
    desc: "Each coaching session covers the six DIRECT steps and is written down, so the agent leaves with one clear focus.",
    measure: "Coaching sessions with all six DIRECT steps written",
    actions: ["I’ll write all six DIRECT steps before I close each coaching session", "I’ll open every session by recalling last week’s commitment (Indicate Focus)", "I’ll ask two self-discovery questions before giving my own view"] },
  { id: "smart", name: "Writes SMART commitments", short: "SMART",
    desc: "One on-call action in the agent’s words, with a number of calls, how it’s checked and a Friday follow-up; the agent acknowledges it.",
    measure: "Commitments that pass the SMART check and the agent acknowledged",
    actions: ["I’ll write each commitment in the agent’s own words and check it with the SMART checker before saving", "I’ll get every agent to acknowledge their commitment in PULSE by Tuesday", "I’ll set the number of calls and how I’ll check them for every commitment"] },
  { id: "root_cause", name: "Diagnoses the root cause", short: "Root cause",
    desc: "Uses calls and survey comments to mark Knowledge, Skill, Will or Tool/Process, and re-diagnoses when a commitment is missed twice.",
    measure: "Agents re-diagnosed after two weeks not met",
    actions: ["I’ll re-check the root cause with the 5 Whys for every agent who missed twice", "I’ll listen to two calls before marking the root cause", "I’ll write the evidence for the root cause in every session"] },
  { id: "tool", name: "Uses the right coaching tool", short: "Right tool",
    desc: "Picks the coaching tool that fits the root cause: quizzes and model tapes for Knowledge, side-by-sides and self tapes for Skill, expectations for Will.",
    measure: "Weekly sessions with a tool that fits the root cause",
    actions: ["I’ll pick each session’s tool from the plan for that root cause", "I’ll use Self Tape vs. Model for every Skill gap this week", "I’ll run a Fast Ball Quiz with every Knowledge gap in Skill Transfer"] },
  { id: "followup", name: "Follows up Friday with evidence", short: "Friday follow-up",
    desc: "Reviews every commitment on Friday with the Monitor count, then gives kudos or holds the agent accountable.",
    measure: "Commitments reviewed by Friday with Monitor evidence",
    actions: ["I’ll review every commitment on Friday with the Monitor count", "I’ll give kudos in front of the team for every commitment met", "I’ll close Friday reviews before 3 pm"] },
];
export const SUP_BEHAVIOR_BY_ID = Object.fromEntries(SUP_BEHAVIORS.map((b) => [b.id, b]));

// DIRECT prompts when the manager coaches a supervisor.
export const LEADER_DIRECT = {
  D: "Check in on the supervisor and the team: workload, wins, anything in the way.",
  I: "Name the one supervisor behavior for this week and recall last week’s commitment and its measured result.",
  R: "Recognize what’s working: a strong coaching session, an agent who improved, a rhythm kept under pressure.",
  E: "Ask, don’t tell: What did you notice in your numbers? Which agents worry you? What would you do differently?",
  C: "Find why the behavior slips: Knowledge (doesn’t know the standard), Skill (knows it, delivery slips), Will (chooses not to) or Tool/Process (time, staffing, systems).",
  T: "Agree on one SMART commitment for this week, how PULSE measures it, and the Friday review.",
};
