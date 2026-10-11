import test from "node:test";
import assert from "node:assert/strict";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { deliveryMetrics, cleanVoice, countFillers } from "../web/core/delivery.js";
import { chunks, pickVoice } from "../web/voice.js";

const setup = () => {
  const store = createMemStore(buildSeed());
  const call = async (user, method, path, body, ai = null) => handle({ method, path, query: {}, body, user }, { store, ai, demo: true });
  return { store, call };
};

test("voice roleplay stores the channel, member voice hints and per-turn timings", async () => {
  const { store, call } = setup();
  const [agent] = await store.list("users", { role: "agent" });
  const rp = await call(agent, "POST", "/api/ai/roleplay", { behavior: "empathy", call_type: "Claim denial", channel: "voice" });
  assert.equal(rp.scenario.channel, "voice");
  assert.equal(rp.scenario.member_gender, "male");
  assert.ok(rp.scenario.member_age >= 25);
  const t1 = await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "I'm sorry, that sounds stressful. Um, let me check the denial for you", voice: { speak_ms: 4200, delay_ms: 900, junk: "x" } });
  const mine = t1.transcript.find((m) => m.who === "agent");
  assert.deepEqual(mine.voice, { speak_ms: 4200, delay_ms: 900 });
  await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "I understand. I'll take care of the appeal and you'll get a letter in 30 days", voice: { speak_ms: 5000, delay_ms: 6500 } });
  const ev = (await call(agent, "POST", `/api/ai/roleplay/${rp.id}/evaluate`)).evaluation;
  assert.equal(ev.delivery.turns, 2);
  assert.equal(ev.delivery.dead_air, 1);
  assert.ok(ev.delivery.wpm > 100 && ev.delivery.wpm < 300);
  assert.ok(ev.delivery.notes.some((n) => /silence/.test(n)));
});

test("text roleplays ignore voice timings and have no delivery block", async () => {
  const { store, call } = setup();
  const [agent] = await store.list("users", { role: "agent" });
  const rp = await call(agent, "POST", "/api/ai/roleplay", { behavior: "warm", call_type: "ID card" });
  assert.equal(rp.scenario.channel, "text");
  const t = await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "Happy to help!", voice: { speak_ms: 1000 } });
  assert.equal(t.transcript.find((m) => m.who === "agent").voice, undefined);
  const ev = (await call(agent, "POST", `/api/ai/roleplay/${rp.id}/evaluate`)).evaluation;
  assert.equal(ev.delivery, null);
});

test("Gemini voice prompts ask for spoken lines, and stage directions are stripped", async () => {
  const { store, call } = setup();
  const [agent] = await store.list("users", { role: "agent" });
  const prompts = [];
  const ai = { generate: async ({ messages }) => { const p = messages.at(-1).text; prompts.push(p);
    if (p.includes("Create a roleplay")) return JSON.stringify({ member_name: "Ana Ruiz", member_gender: "female", member_age: 72, situation: "s", mood: "worried", opening: "*sighs* Hi, I need help 😟 with my card.", hidden_need: "h", success_criteria: ["a", "b", "c"] });
    if (p.includes("Stay in character")) return JSON.stringify({ reply: "(frustrated tone) Okay... [pause] when will it come?", mood: "frustrated", end: false });
    return JSON.stringify({ score: 4, summary: "ok", did_well: [], improve: [], model_lines: [], delivery_tip: "Slow down." }); } };
  const rp = await call(agent, "POST", "/api/ai/roleplay", { behavior: "expectations", call_type: "ID card", channel: "voice" }, ai);
  assert.equal(rp.scenario.opening, "Hi, I need help with my card.");
  const t = await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "sure let me look", voice: { speak_ms: 2000, delay_ms: 500 } }, ai);
  assert.equal(t.transcript.at(-1).text, "Okay... when will it come?");
  assert.match(prompts[1], /read aloud by text-to-speech/);
  const ev = (await call(agent, "POST", `/api/ai/roleplay/${rp.id}/evaluate`, {}, ai)).evaluation;
  assert.match(prompts[2], /Delivery \(approximate/);
  assert.equal(ev.delivery_tip, "Slow down.");
  assert.equal(ev.delivery.turns, 1);
});

test("delivery metrics: pace, interruptions, fillers and talk share", () => {
  const t = [
    { who: "member", text: "Hi I lost my card" },
    { who: "agent", text: "uh you know I can I mean help with that um sure", voice: { speak_ms: 3000, delay_ms: 1000, interrupted: true } },
  ];
  const d = deliveryMetrics(t);
  assert.equal(d.interruptions, 1);
  assert.equal(countFillers(t[1].text), 4);
  assert.ok(d.fillers_per_100 > 4);
  assert.ok(d.talk_share > 50);
  assert.equal(cleanVoice({ speak_ms: -5, delay_ms: "abc" }).speak_ms, 0);
  assert.equal(cleanVoice({ speak_ms: 900, delay_ms: null }).delay_ms, null);
  assert.equal(cleanVoice("nope"), null);
  assert.equal(deliveryMetrics([{ who: "agent", text: "hi" }]), null);
});

test("speech helpers: sentence chunks and voice choice by gender", () => {
  const long = "One. ".repeat(60);
  assert.ok(chunks(long).every((c) => c.length <= 180));
  const voices = [
    { name: "Microsoft Guy Online (Natural) - English (United States)", lang: "en-US" },
    { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US" },
    { name: "Google español", lang: "es-ES" },
  ];
  assert.match(pickVoice(voices, { gender: "female", seed: "Ana" }).name, /Aria/);
  assert.match(pickVoice(voices, { gender: "male", seed: "Victor" }).name, /Guy/);
  assert.match(pickVoice(voices, { gender: "male", preferred: voices[1].name }).name, /Aria/);
});
