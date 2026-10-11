// Notification bar: shows what's new for the person signed in (a DIRECT session, a quiz or a roleplay for agents;
// results from agents and 1:1s for supervisors; supervisor follow-up for managers). Plus a bell with the full list.
import { esc, $, $$, icon } from "../ui.js";

const ICON = {
  direct_session: "clip", quiz_assigned: "quiz", roleplay_assigned: "chat", commitment_review: "check",
  quiz_done: "quiz", roleplay_done: "chat", roleplay_note: "chat", leader_session: "users", leader_review: "check", leader_ack: "check",
  sup_unmarked: "cal", sup_overdue: "cal", leader_review_due: "check", leader_not_ack: "users", leader_missing: "users",
};
const ago = (iso) => {
  const t = new Date(String(iso).length <= 19 ? iso + "Z" : iso).getTime(), m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function createNotifier({ api, go, host, bell }) {
  let data = { unread: 0, items: [] }, timer = null, panel = null;

  const open = async (n) => {
    if (!n.read_at) { try { await api("POST", "/api/notifications/read", { ids: [n.id] }); } catch {} }
    closePanel();
    if (n.link?.view) go(n.link.view, n.link.params || {});
    refresh();
  };
  const dismiss = async (ids) => { try { await api("POST", "/api/notifications/read", ids === "all" ? { all: true } : { ids }); } catch {} refresh(); };

  function drawBar() {
    const unread = data.items.filter((n) => !n.read_at);
    if (!unread.length) { host.innerHTML = ""; host.hidden = true; return; }
    host.hidden = false;
    const show = unread.slice(0, 3);
    host.innerHTML = `<div class="nbar" role="region" aria-label="New for you">
      <div class="nbar-h"><b>New for you</b><span class="chip teal">${unread.length}</span><span class="grow"></span>
        ${unread.length > 3 ? `<button class="btn sm ghost" data-more>See all ${unread.length}</button>` : ""}<button class="btn sm ghost" data-clear>Mark all as read</button></div>
      ${show.map((n) => `<div class="nitem" data-id="${n.id}">${icon(ICON[n.type] || "spark")}<div class="grow"><div class="t">${esc(n.title)}</div>${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ""}</div>
        <span class="small muted nowrap">${ago(n.created_at)}</span>${n.link?.view ? `<button class="btn sm primary" data-open="${n.id}">Open</button>` : ""}<button class="nx" data-x="${n.id}" aria-label="Dismiss">×</button></div>`).join("")}
    </div>`;
    $$("[data-open]", host).forEach((b) => (b.onclick = () => open(data.items.find((n) => n.id === b.dataset.open))));
    $$("[data-x]", host).forEach((b) => (b.onclick = () => dismiss([b.dataset.x])));
    const more = $("[data-more]", host); if (more) more.onclick = openPanel;
    $("[data-clear]", host).onclick = () => dismiss("all");
  }
  function drawBell() {
    if (!bell) return;
    bell.innerHTML = `${icon("bell")}<span>Notifications</span>${data.unread ? `<span class="nbadge">${data.unread > 99 ? "99+" : data.unread}</span>` : ""}`;
    bell.setAttribute("aria-label", `Notifications${data.unread ? `, ${data.unread} new` : ""}`);
  }
  function openPanel() {
    closePanel();
    panel = document.createElement("div");
    panel.className = "overlay";
    panel.innerHTML = `<div class="modal npanel" role="dialog" aria-modal="true" aria-label="Notifications"><div class="spread"><h3>Notifications</h3><div class="row"><button class="btn sm ghost" data-all>Mark all as read</button><button class="btn sm" data-close>Close</button></div></div>
      ${data.items.length ? `<div class="list mt">${data.items.map((n) => `<button class="nrow${n.read_at ? "" : " unread"}" data-n="${n.id}">${icon(ICON[n.type] || "spark")}<span class="grow"><span class="t">${esc(n.title)}</span>${n.body ? `<span class="small muted">${esc(n.body)}</span>` : ""}</span><span class="small muted nowrap">${ago(n.created_at)}</span></button>`).join("")}</div>` : `<div class="empty mt">Nothing yet.</div>`}</div>`;
    document.body.appendChild(panel);
    panel.addEventListener("click", (e) => { if (e.target === panel || e.target.closest("[data-close]")) closePanel(); });
    $("[data-all]", panel).onclick = async () => { await dismiss("all"); openPanel(); };
    $$("[data-n]", panel).forEach((b) => (b.onclick = () => open(data.items.find((n) => n.id === b.dataset.n))));
    const onKey = (e) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("keydown", onKey); panel._off = () => document.removeEventListener("keydown", onKey);
    $("[data-close]", panel).focus();
  }
  function closePanel() { if (panel) { panel._off?.(); panel.remove(); panel = null; } }

  async function refresh() {
    try { data = await api("GET", "/api/notifications"); } catch { return; }
    drawBar(); drawBell();
  }
  if (bell) bell.onclick = openPanel;
  refresh();
  timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  return { refresh, stop: () => { clearInterval(timer); closePanel(); } };
}
