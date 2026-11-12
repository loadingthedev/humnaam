import { appendFile } from "node:fs/promises";
import { LIKELY, match } from "../src/index";
import { full, type Pair } from "./pairs";
import { measure } from "./run";

const MODEL = "typesafe/jev-1.14";
const CACHE = "bench/llm/jev-1.14.jsonl";
const BUDGET = 4; // US dollars across the whole key
// Fixed on the development set before the test set was run.
const QUESTION = {
  type: "noul",
  instructions: "Are these two names the same person's name?",
  criteria: {
    true: "The names differ only in spelling or transliteration, an abbreviation, initials, word order, a title, or a missing part of the name.",
    false: "A given name or a family name in one is a different name from the other.",
  },
};

type Answer = {
  set: string;
  key: string;
  noul: number | null;
  raw?: string;
  cost: number;
  ms: number;
};
const key = (p: Pair) => [p.uidA, p.uidB, full(p.a), full(p.b)].join("|");

/** The probability of yes, or null when the response is not a clear answer. */
export function parse(body: any): number | null {
  const a = body?.answers?.same;
  return a?.type === "noul" && typeof a.noul === "number" && a.noul >= 0 && a.noul <= 1
    ? a.noul
    : null;
}

async function ask(p: Pair): Promise<Omit<Answer, "set" | "key">> {
  const started = performance.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        state: { first_name: full(p.a), second_name: full(p.b) },
        questions: { same: QUESTION },
      }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await Bun.sleep(1000 * 2 ** attempt);
      continue;
    }
    // Any other failure stops the run: a wrong key or an empty budget must not be cached as answers.
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const body: any = await res.json();
    if (typeof body?.usage?.cost !== "number") throw new Error("response without usage.cost");
    const noul = parse(body);
    return {
      noul,
      ...(noul === null && { raw: JSON.stringify(body.answers).slice(0, 300) }),
      cost: body.usage.cost,
      ms: Math.round(performance.now() - started),
    };
  }
}

const load = async (set: string): Promise<Pair[]> =>
  (await Bun.file(`bench/pairs/${set}.jsonl`).text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

if (import.meta.main) {
  const flag = (name: string) => process.argv.indexOf(name);
  const limit = flag("--limit") > 0 ? Number(process.argv[flag("--limit") + 1]) : Infinity;
  const cached = new Map<string, Answer>();
  if (await Bun.file(CACHE).exists())
    for (const line of (await Bun.file(CACHE).text()).trim().split("\n")) {
      const a: Answer = JSON.parse(line);
      cached.set(`${a.set}|${a.key}`, a);
    }

  const sets: Record<string, Pair[]> = { dev: (await load("dev")).slice(0, limit) };
  // The test set is held back: it is read only when asked for, and nothing is tuned on it.
  if (flag("--test") > 0) sets.test = await load("test");

  const todo = Object.entries(sets).flatMap(([set, pairs]) =>
    pairs.filter((p) => !cached.has(`${set}|${key(p)}`)).map((p) => ({ set, p })),
  );
  if (todo.length) {
    const seen = [...cached.values()];
    // Before any answer exists, assume 300 input tokens a pair at $0.042 per million.
    const each = seen.length ? seen.reduce((t, a) => t + a.cost, 0) / seen.length : 300 * 0.042e-6;
    const k: any = await (
      await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      })
    ).json();
    const spent = k?.data?.usage;
    if (typeof spent !== "number") throw new Error("could not read the key's usage");
    const estimate = todo.length * each;
    console.log(
      `${todo.length} pairs to ask, about $${estimate.toFixed(4)}; key has spent $${spent.toFixed(4)}`,
    );
    if (spent + estimate > BUDGET) throw new Error(`over the $${BUDGET} budget, not running`);

    let next = 0;
    await Promise.all(
      Array.from({ length: 16 }, async () => {
        while (next < todo.length) {
          const { set, p } = todo[next++]!;
          const a: Answer = { set, key: key(p), ...(await ask(p)) };
          cached.set(`${set}|${a.key}`, a);
          await appendFile(CACHE, JSON.stringify(a) + "\n");
        }
      }),
    );
  }

  const answers = (set: string) => sets[set]!.map((p) => cached.get(`${set}|${key(p)}`)!);
  // An answer that is not a clear probability counts as wrong at every cut-off.
  const scores = (set: string) =>
    answers(set).map((a, i) => a.noul ?? (sets[set]![i]!.match ? -1 : 2));
  const ours = (set: string) => sets[set]!.map((p) => match(full(p.a), full(p.b)).score);
  const hybrid = (set: string, lo: number, hi: number) => {
    const model = scores(set);
    return ours(set).map((s, i) => (s >= hi ? 1 : s < lo ? 0 : model[i]! >= 0.5 ? 1 : 0));
  };

  // Tuned on the development set only: the model's cut-off for 95% precision, and the band of humnaam scores sent to the model.
  let cut = 1;
  for (let i = 100; i >= 0; i--) {
    const r = measure(scores("dev"), sets.dev!, i / 100);
    if (r.recall > 0 && r.precision >= 0.95) cut = i / 100;
  }
  let band = { lo: 0, hi: 0, f1: 0, sent: 1 };
  const devOurs = ours("dev");
  for (let lo = 0; lo <= 0.5; lo += 0.05)
    for (let hi = lo; hi <= 1.0001; hi += 0.05) {
      const f1 = measure(hybrid("dev", lo, hi), sets.dev!, 0.5).f1;
      const sent = devOurs.filter((s) => s >= lo && s < hi).length / devOurs.length;
      // A wider band must earn its cost: it needs 0.1 more F1 points to replace a narrower one.
      if (f1 > band.f1 + (sent > band.sent ? 0.001 : 0)) band = { lo, hi, f1, sent };
    }

  const pct = (n: number) => (n * 100).toFixed(1);
  for (const set of Object.keys(sets)) {
    const pairs = sets[set]!;
    const as = answers(set);
    const cost = (as.reduce((t, a) => t + a.cost, 0) / as.length) * 1000;
    const ms = as.reduce((t, a) => t + a.ms, 0) / as.length;
    const started = performance.now();
    const mine = ours(set);
    const micros = ((performance.now() - started) * 1000) / pairs.length;
    const sent = mine.filter((s) => s >= band.lo && s < band.hi).length / pairs.length;
    const row = (name: string, s: number[], t: number, dollars: number, time: string) => {
      const r = measure(s, pairs, t);
      return {
        matcher: name,
        precision: pct(r.precision),
        recall: pct(r.recall),
        f1: pct(r.f1),
        "$ per 1,000 pairs": dollars.toFixed(4),
        "time per pair": time,
      };
    };
    console.log(
      `\n${set} set: ${pairs.length} pairs, ${as.filter((a) => a.noul === null).length} answers not a clear yes or no`,
    );
    console.table([
      row(`humnaam at ${LIKELY}`, mine, LIKELY, 0, `${micros.toFixed(0)} µs`),
      row(`${MODEL} at 0.50`, scores(set), 0.5, cost, `${ms.toFixed(0)} ms`),
      row(
        `${MODEL} at ${cut.toFixed(2)} (95% precision on dev)`,
        scores(set),
        cut,
        cost,
        `${ms.toFixed(0)} ms`,
      ),
      row(
        `humnaam, then ${MODEL} for scores ${band.lo.toFixed(2)} to ${band.hi.toFixed(2)}`,
        hybrid(set, band.lo, band.hi),
        0.5,
        cost * sent,
        `${pct(sent)}% of pairs sent`,
      ),
    ]);
  }
  console.log(
    `\ntotal cost of the cached answers: $${[...cached.values()].reduce((t, a) => t + a.cost, 0).toFixed(4)}`,
  );
}
