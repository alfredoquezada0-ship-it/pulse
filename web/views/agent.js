// Agent views: my week (commitment, sessions, self-log), quizzes, progress.
import { KPIS, SESSION_TYPES } from "../core/constants.js";
import { esc, $, $$, kpiTile, statusChip, bName, rcName, sName, dateLabel, weekLabel, fmtKpi, behaviorOf } from "../ui.js";

const head = (title, sub, actions = "") => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;

export async function myWeek(main, _p, { api, go, toast }) {
  const [d, plays] = await Promise.all([api("GET", "/api/dashboard/agent"), api("GET", "/api/roleplay-assignments")]);
  const c = d.current, b = c ? behaviorOf(c.behavior) || { name: bName(c.behavior), desc: "", sounds: "", how: [] } : null;
  const due = d.quizzes.filter((q) => q.status !== "completed");
  const rps = plays.filter((x) => x.status === "assigned" || x.status === "started");
  main.innerHTML = head(`Hi, ${esc(d.me.name.split(" ")[0])}`, `${weekLabel(d.week)}${d.supervisor ? ` · Supervisor ${esc(d.supervisor)}` : ""}`) +
  `<div class="grid g-main"><div class="stack">
    <div class="card"><div class="card-h"><h3>My commitment this week</h3>${c ? statusChip(c.status) : ""}</div>
    ${c ? `<div class="row"><span class="chip teal">${esc(b.name)}</span></div>
      <div class="sticky mt"><span class="eyebrow">What I agreed to do on my calls</span><p style="font-weight:650;font-size:1.1rem;margin-top:4px">“${esc(c.action)}”</p></div>
      <p class="small mt"><b>Goal:</b> ${c.measure_target} of ${c.measure_total} calls · <b>Checked by:</b> ${esc(c.check_method || "")} · <b>Review:</b> ${dateLabel(c.follow_up_date)}</p>
      <p class="small muted mt">${esc(b.desc)}${b.sounds ? ` Sounds like: ${esc(b.sounds)}` : ""}</p>
      ${b.how?.length ? `<details class="mt"><summary class="small"><b>How to do it on the call</b></summary><ol class="small steps-ol">${b.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>${b.avoid?.length ? `<p class="small"><b>Avoid:</b> ${b.avoid.map(esc).join("; ")}</p>` : ""}</details>` : ""}
      <div class="row mt">${c.agent_ack ? `<span class="chip ok">You acknowledged this commitment</span>` : `<button class="btn primary" id="ack">I agree to this commitment</button>`}</div>
      <hr><div class="spread"><div><span class="eyebrow">My self-log</span><div class="small">Calls where I did it this week</div></div><div class="row"><button class="btn sm" data-d="-1" aria-label="Remove one">−</button><b class="mono" style="font-size:1.6rem">${c.self_hits || 0}</b><button class="btn sm primary" data-d="1">+1 call</button></div></div>
      <p class="small muted mt">Your supervisor checks real calls in Monitor on Wed–Thu. Your log helps you both see the habit forming.</p>`
      : `<div class="empty">No commitment yet this week. You’ll set it with your supervisor in Setting Goals (Mon–Tue).</div>`}</div>
    <div class="card"><h3>My coaching week</h3>${d.weekly.length ? `<div class="list">${SESSION_TYPES.map((t) => { const s = d.weekly.find((w) => w.type === t.id); return `<div class="li"><span class="chip plain">${esc(t.window)}</span><div class="grow"><div class="t">${esc(t.name)}</div><div class="small muted">${s ? `${dateLabel(s.planned_date)} ${esc(s.planned_time || "")} · ${esc(s.tool || "")}` : "Not planned yet"}</div></div>${s ? statusChip(s.status) : ""}</div>`; }).join("")}</div>` : `<div class="empty">Nothing planned yet.</div>`}</div>
  </div><div class="stack">
    <div class="card"><h3>To do</h3>${due.length || rps.length ? `<div class="list">${due.map((q) => `<div class="li"><div class="grow"><div class="t">${esc(q.title)}</div><div class="small muted">Quiz · ${esc(bName(q.behavior))} · ${q.questions.length} questions</div></div><button class="btn sm primary" data-quiz="${q.id}">Take quiz</button></div>`).join("")}
      ${rps.map((x) => `<div class="li"><div class="grow"><div class="t">Roleplay: ${esc(bName(x.behavior))}</div><div class="small muted">${esc(x.call_type || "")} · ${x.channel === "voice" ? "voice call" : "chat"}${x.due_date ? ` · by ${dateLabel(x.due_date)}` : ""}</div></div><button class="btn sm primary" data-rp="${x.id}">Start</button></div>`).join("")}</div>` : `<p class="small muted">Nothing waiting. Nice.</p>`}
      <hr><button class="btn ai" data-go="practice">Practice ${c ? esc(b.name) : "a behavior"} with a simulated member</button></div>
    <div class="kpis k3">${["nps", "csat", "fcr"].map((k) => kpiTile(k, d.summary.kpis[k])).join("")}</div>
  </div></div>`;
  const ack = $("#ack", main); if (ack) ack.onclick = async () => { await api("POST", `/api/commitments/${c.id}/ack`); toast("Thanks. Your supervisor can see you agreed."); go("my-week"); };
  $$("[data-d]", main).forEach((btn) => (btn.onclick = async () => { await api("POST", `/api/commitments/${c.id}/self-log`, { delta: Number(btn.dataset.d) }); go("my-week"); }));
  $$("[data-quiz]", main).forEach((btn) => (btn.onclick = () => go("my-quizzes", { id: btn.dataset.quiz })));
  $$("[data-rp]", main).forEach((btn) => (btn.onclick = () => go("practice", { assignment: btn.dataset.rp })));
  $$("[data-go]", main).forEach((btn) => (btn.onclick = () => go(btn.dataset.go)));
}

export async function myQuizzes(main, params, { api, go, toast }) {
  const list = await api("GET", "/api/quizzes");
  const open = list.find((q) => q.id === params.id && q.status !== "completed") || (params.id ? null : list.find((q) => q.status !== "completed"));
  main.innerHTML = head("Quizzes", "Short checks your supervisor assigns on the behavior you’re working on.") + `<div class="grid g-main"><div id="take"></div><div class="card"><h3>All quizzes</h3>${list.length ? `<div class="list">${list.map((q) => `<div class="li"><div class="grow"><div class="t">${esc(q.title)}</div><div class="small muted">${esc(bName(q.behavior))}</div></div>${q.status === "completed" ? `<span class="chip ${q.score >= 80 ? "ok" : "warn"}">${q.score}%</span>` : `<button class="btn sm" data-q="${q.id}">Start</button>`}</div>`).join("")}</div>` : `<div class="empty">No quizzes yet.</div>`}</div></div>`;
  $$("[data-q]", main).forEach((b) => (b.onclick = () => go("my-quizzes", { id: b.dataset.q })));
  const take = $("#take", main);
  if (!open) { take.innerHTML = `<div class="card"><div class="empty">You’re all caught up.</div></div>`; return; }
  const answers = new Array(open.questions.length).fill(null);
  take.innerHTML = `<div class="card"><h3>${esc(open.title)}</h3>${open.questions.map((x, i) => `<div class="qq"><b>${i + 1}. ${esc(x.q)}</b>${x.o.map((o, j) => `<button class="opt" data-i="${i}" data-j="${j}" aria-pressed="false"><span class="k">${"ABCD"[j]}</span><span>${esc(o)}</span></button>`).join("")}</div>`).join("")}<div class="row mt"><button class="btn primary" id="submit">Submit answers</button></div><div id="res" class="mt"></div></div>`;
  $$(".opt", take).forEach((b) => (b.onclick = () => { const i = +b.dataset.i; answers[i] = +b.dataset.j; $$(`.opt[data-i="${i}"]`, take).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
  $("#submit", take).onclick = async () => {
    if (answers.some((a) => a === null)) return toast("Answer every question first.", "err");
    try {
      await api("POST", `/api/quizzes/${open.id}/submit`, { answers });
      const done = (await api("GET", "/api/quizzes")).find((q) => q.id === open.id);
      $$(".opt", take).forEach((b) => { const i = +b.dataset.i, j = +b.dataset.j; b.disabled = true; if (done.questions[i].a === j) b.classList.add("right"); else if (answers[i] === j) b.classList.add("wrong"); });
      $("#submit", take).hidden = true;
      $("#res", take).innerHTML = `<div class="sticky"><b>${done.score}%</b> · ${done.score >= 80 ? "Nice work." : "Review the explanations below, then practice it on your next calls."}${done.questions.map((x, i) => `<p class="small mt">${i + 1}. ${esc(x.why || "")}</p>`).join("")}</div>`;
    } catch (e) { toast(e.message, "err"); }
  };
}

export async function myProgress(main, _p, { api }) {
  const d = await api("GET", "/api/dashboard/agent");
  const all = [d.current, ...d.history].filter(Boolean);
  main.innerHTML = head("My progress", "Your KPIs over the last 8 weeks (4-week averages vs. goal) and your commitment history.") +
    `<div class="kpis">${KPIS.map((k) => kpiTile(k.id, d.summary.kpis[k.id])).join("")}</div>
    <div class="card mt"><h3>My commitments</h3>${all.length ? `<div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Week</th><th>Behavior</th><th>What I committed to</th><th>Calls checked</th><th>Result</th></tr></thead><tbody>
      ${all.map((c) => `<tr><td class="num">${dateLabel(c.week_start)}</td><td>${esc(bName(c.behavior))}</td><td>${esc(c.action)}</td><td class="num">${c.monitor_total ? `${c.monitor_hits}/${c.monitor_total}` : "—"}</td><td>${statusChip(c.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No commitments yet.</div>`}</div>`;
}
