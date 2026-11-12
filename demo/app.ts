/// <reference lib="dom" />
import { LIKELY, match, type Match, type Part } from "../src/index.ts";
import source from "../bench/pairs/source.json";
import names from "./names.json";

const FLOOR = 0.15;
const TOP = 20;
// About 15 ms of work per chunk on a laptop, so a phone still yields to keystrokes several times a second.
const CHUNK = 2000;
const EXAMPLES = [
  ["Usama Ben Laden", "spelling"],
  ["Mohd Saeed", "abbreviation"],
  ["H. Nasrallah", "initial"],
  ["Ibrahim Dawood", "word order"],
  ["Abdulrahman", "joined"],
  ["Aiman Rabi Zawahiri", "missing middle"],
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
// Floored, so a score just under the line never prints as 0.41.
const fmt = (s: number) => (Math.floor(s * 100) / 100).toFixed(2);
const count = names.length.toLocaleString("en");

function pairing(parts: Part[]) {
  const ol = el("ol", "parts");
  ol.setAttribute("aria-hidden", "true");
  for (const p of parts) {
    const li = el("li", `part how-${p.how}`);
    li.append(
      el("span", p.a ? "w" : "w none", p.a ?? "—"),
      el("span", p.b ? "w" : "w none", p.b ?? "—"),
      el("span", "how", p.how),
    );
    ol.append(li);
  }
  return ol;
}

function result(name: string, m: Match) {
  const likely = m.score >= LIKELY;
  const li = el("li", likely ? "result likely" : "result");
  const score = el("p", "score");
  score.append(
    el("span", "label", likely ? "likely match" : "possible"),
    el("span", "value", fmt(m.score)),
  );
  li.append(el("p", "name", name), score, pairing(m.parts), el("p", "reason", m.reason));
  return li;
}

const q = $<HTMLInputElement>("q");
const status = $("status");
const results = $("results");
let latest = 0;

async function search() {
  const query = q.value;
  const id = ++latest;
  if (!query.trim()) {
    results.replaceChildren();
    status.textContent = `Type a name to search ${count} names.`;
    return;
  }
  const hits: { name: string; m: Match }[] = [];
  let ms = 0;
  for (let i = 0; i < names.length; i += CHUNK) {
    const t = performance.now();
    for (let j = i; j < Math.min(i + CHUNK, names.length); j++) {
      const m = match(query, names[j]!);
      if (m.score >= FLOOR) hits.push({ name: names[j]!, m });
    }
    ms += performance.now() - t;
    await new Promise((r) => setTimeout(r));
    if (id !== latest) return;
  }
  hits.sort((x, y) => y.m.score - x.m.score);
  const likely = hits.filter((h) => h.m.score >= LIKELY).length;
  status.textContent =
    `${count} names searched in ${Math.round(ms)} ms. ` +
    (hits.length
      ? `${likely} likely ${likely === 1 ? "match" : "matches"}` +
        (hits.length > likely ? `, ${hits.length - likely} possible` : "") +
        (hits.length > TOP ? `; top ${TOP} shown.` : ".")
      : `No name scores ${FLOOR} or more.`);
  results.replaceChildren(...hits.slice(0, TOP).map((h) => result(h.name, h.m)));
}

const examples = $("examples");
for (const [text, shows] of EXAMPLES) {
  const button = el("button", "example");
  button.setAttribute("type", "button");
  button.append(el("span", "text", text!), el("span", "shows", shows!));
  button.addEventListener("click", () => {
    q.value = text!;
    search();
  });
  const li = document.createElement("li");
  li.append(button);
  examples.append(li);
}
q.addEventListener("input", search);

const a = $<HTMLInputElement>("a");
const b = $<HTMLInputElement>("b");
const verdict = $("verdict");

function compare() {
  const m = match(a.value, b.value);
  const likely = m.score >= LIKELY;
  verdict.className = likely ? "verdict likely" : "verdict";
  const head = el("p", "score");
  head.append(
    el("span", "label", likely ? "Likely match" : "Not a likely match"),
    el("span", "value", fmt(m.score)),
  );
  const scale = el("div", "scale");
  scale.setAttribute("aria-hidden", "true");
  scale.style.setProperty("--score", String(m.score));
  scale.style.setProperty("--likely", String(LIKELY));
  scale.append(el("span", "fill"), el("span", "tick", `likely from ${LIKELY}`));
  verdict.replaceChildren(head, scale, pairing(m.parts), el("p", "reason", m.reason));
}
a.addEventListener("input", compare);
b.addEventListener("input", compare);

const [month, day, year] = source.publishDate.split("/").map(Number);
const published = $("published");
published.setAttribute(
  "dateTime",
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
);
published.textContent = new Date(year!, month! - 1, day).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
$("count").textContent = count;
$("likely").textContent = String(LIKELY);
$("footer-count").textContent = `${count} full names (main names and strong aliases)`;

q.value = EXAMPLES[1]![0]!;
search();
a.value = "Mohd Abdul Rahman Chaudhary";
b.value = "Choudhury Muhammad Abdurrahman";
compare();
