// Password rules, shared by the server (enforced) and the browser (live checklist).
import { fold } from "./roster.js";

export const PASSWORD_RULES = [
  { id: "length", text: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { id: "mix", text: "Letters and at least one number", test: (pw) => /[A-Za-z]/.test(pw) && /\d/.test(pw) },
  { id: "personal", text: "Not your name or your login", test: (pw, who) => !personalBits(who).some((b) => fold(pw).includes(b)) },
];

// Name parts and login of 4+ letters, e.g. "jordy", "feliz", "jordy_feliz_diaz".
function personalBits({ name = "", email = "" } = {}) {
  const local = fold(String(email).split("@")[0]);
  return [...fold(name).split(/[^a-z]+/), ...local.split(/[^a-z]+/), local].filter((w) => w.length >= 4);
}

export const passwordProblems = (pw, who) => PASSWORD_RULES.filter((r) => !r.test(String(pw || ""), who)).map((r) => r.text);

// A temporary password for resets: easy to read out loud, no look-alike characters.
// Temporary passwords: easy to read out, hard to guess (about 35 bits), and people must change them at first sign-in.
export function tempPassword() {
  const words = ["Coach", "Pulse", "Direct", "Smart", "Bright", "Steady", "Clear", "Warm", "Focus", "Kind", "Swift", "Solid", "Calm", "Sharp", "Brave", "Fresh"];
  const n = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  const letters = "abcdefghjkmnpqrstuvwxyz";
  return `${words[n() % 16]}-${words[n() % 16]}-${String(n() % 9000 + 1000)}${letters[n() % letters.length]}${letters[n() % letters.length]}`;
}
