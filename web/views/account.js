// Passwords: the first-sign-in screen, "Change password" for everyone, and "Reset password" for leaders.
import { PASSWORD_RULES, passwordProblems, tempPassword } from "../core/password.js";
import { esc, $, modal, toast } from "../ui.js";

const rulesList = () => `<ul class="pw-rules" aria-live="polite">${PASSWORD_RULES.map((r) => `<li data-rule="${r.id}">${esc(r.text)}</li>`).join("")}<li data-rule="match">Both passwords match</li></ul>`;
const eye = (id) => `<button type="button" class="btn sm ghost pw-show" data-for="${id}" aria-label="Show password">Show</button>`;

// Live checklist + show/hide; returns a function that tells whether the form is ready.
function wire(root, who) {
  const pw = $("#pw-new", root), again = $("#pw-again", root), btn = $("[type=submit]", root);
  const update = () => {
    const bad = new Set(PASSWORD_RULES.filter((r) => !r.test(pw.value, who)).map((r) => r.id));
    root.querySelectorAll("[data-rule]").forEach((li) => {
      const ok = li.dataset.rule === "match" ? pw.value && pw.value === again.value : !bad.has(li.dataset.rule) && pw.value;
      li.classList.toggle("ok", !!ok);
    });
    const ready = !bad.size && pw.value === again.value;
    btn.disabled = !ready;
    return ready;
  };
  pw.oninput = again.oninput = update;
  root.querySelectorAll(".pw-show").forEach((b) => (b.onclick = () => {
    const inp = $("#" + b.dataset.for, root); const show = inp.type === "password";
    inp.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }));
  update();
  return update;
}

// Full-page screen after signing in with a temporary password. Nothing else opens until it's done.
export function renderSetPassword({ state, api, onDone, onSignOut }) {
  const u = state.user;
  document.body.innerHTML = `<div class="login"><div class="login-card" style="width:min(100%,520px)">
    <p class="eyebrow">Welcome to PULSE</p>
    <h1 style="font-size:clamp(1.6rem,4vw,2.2rem)">Hi ${esc(u.name.split(" ")[0])}, choose your password</h1>
    <p class="muted mt">You signed in with a temporary password. Pick one only you know; you’ll use it from now on.</p>
    <form id="pwf" class="mt2" autocomplete="on">
      <input type="email" autocomplete="username" value="${esc(u.email || "")}" hidden readonly>
      <label class="f">New password<span class="pw-field"><input class="in" id="pw-new" type="password" autocomplete="new-password" required>${eye("pw-new")}</span></label>
      <label class="f mt">Type it again<span class="pw-field"><input class="in" id="pw-again" type="password" autocomplete="new-password" required>${eye("pw-again")}</span></label>
      ${rulesList()}
      <div class="row mt"><button class="btn primary" type="submit" disabled>Save my password</button><button class="btn ghost" type="button" id="pw-out">Sign out</button></div>
      <p class="small muted mt">Forgot it later? Your supervisor or manager can give you a new temporary password.</p>
    </form></div></div>`;
  const form = $("#pwf"); const ready = wire(form, u);
  $("#pw-new").focus();
  $("#pw-out").onclick = onSignOut;
  form.onsubmit = async (e) => {
    e.preventDefault(); if (!ready()) return;
    const btn = $("[type=submit]", form); btn.disabled = true; btn.textContent = "Saving…";
    try {
      state.user = await api("POST", "/api/me/password", { password: $("#pw-new").value });
      toast("Password saved. You’re all set.");
      onDone();
    } catch (err) { toast(err.message, "err"); btn.textContent = "Save my password"; ready(); }
  };
}

// Sidebar › Password: needs the current one.
export function changePasswordModal({ state, api }) {
  const m = modal(`<h3>Change your password</h3>
    <form id="pwc" class="mt" autocomplete="on">
      <input type="email" autocomplete="username" value="${esc(state.user.email || "")}" hidden readonly>
      <label class="f">Current password<span class="pw-field"><input class="in" id="pw-cur" type="password" autocomplete="current-password" required>${eye("pw-cur")}</span></label>
      <label class="f mt">New password<span class="pw-field"><input class="in" id="pw-new" type="password" autocomplete="new-password" required>${eye("pw-new")}</span></label>
      <label class="f mt">Type it again<span class="pw-field"><input class="in" id="pw-again" type="password" autocomplete="new-password" required>${eye("pw-again")}</span></label>
      ${rulesList()}
      <div class="row mt"><button class="btn primary" type="submit" disabled>Change password</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`);
  const form = $("#pwc", m.el); const ready = wire(form, state.user);
  form.onsubmit = async (e) => {
    e.preventDefault(); if (!ready()) return;
    try { state.user = await api("POST", "/api/me/password", { current: $("#pw-cur", form).value, password: $("#pw-new", form).value }); m.close(); toast("Password changed."); }
    catch (err) { toast(err.message, "err"); }
  };
}

// Leaders: give a team member a new temporary password. They pick their own at the next sign-in.
export function resetPasswordModal(person, { api }) {
  const temp = tempPassword();
  const m = modal(`<h3>Reset ${esc(person.name.split(" ")[0])}’s password</h3>
    <p class="small muted mt">${esc(person.name)} gets this temporary password and must choose their own the next time they sign in. Tell them in person or in a private message, never in a group chat.</p>
    <form id="pwr" class="mt">
      <label class="f">Temporary password<span class="pw-field"><input class="in mono" id="pw-tmp" value="${esc(temp)}" autocomplete="off" required minlength="8"><button type="button" class="btn sm ghost" id="pw-gen">New one</button></span></label>
      <div class="row mt"><button class="btn primary" type="submit">Reset password</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>
    <div id="pw-done" class="mt"></div>`);
  $("#pw-gen", m.el).onclick = () => ($("#pw-tmp", m.el).value = tempPassword());
  $("#pwr", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const pw = $("#pw-tmp", m.el).value.trim();
    try {
      const r = await api("POST", `/api/people/${person.id}/reset-password`, { password: pw });
      $("#pwr", m.el).hidden = true;
      $("#pw-done", m.el).innerHTML = `<div class="sticky"><b>Done.</b> Give ${esc(r.name.split(" ")[0])} these to sign in:<br>Login: <span class="mono">${esc(r.email)}</span><br>Temporary password: <span class="mono">${esc(pw)}</span></div>
        <div class="row mt"><button class="btn" id="pw-copy">Copy</button><button class="btn ghost" data-close>Close</button></div>`;
      $("#pw-copy", m.el).onclick = async () => { try { await navigator.clipboard.writeText(`PULSE login: ${r.email}\nTemporary password: ${pw}`); toast("Copied."); } catch { toast("Couldn’t copy. Select the text instead.", "err"); } };
    } catch (err) { toast(err.message, "err"); }
  };
}
