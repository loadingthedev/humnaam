import { search } from "fuzzy-names";
// @ts-expect-error the package ships no types
import nameMatch from "name-match";
import { matchNames } from "name-match-advanced";
import { namesFuzzyMatch } from "person-name-match";
import { LIKELY, match } from "../src/index";
import { full, type Pair } from "./pairs";

// `threshold` is the package's own documented cut-off (ours is LIKELY); the other cut-offs are tuned on the development set.
type Matcher = { name: string; threshold?: number; score: (p: Pair) => number };

const matchers: Matcher[] = [
  {
    name: "fuzzy-names",
    threshold: 1,
    score: (p) => (search(full(p.a), [full(p.b)]) === null ? 0 : 1),
  },
  { name: "name-match", threshold: 0.75, score: (p) => nameMatch.match(full(p.a), full(p.b)) },
  {
    name: "name-match-advanced",
    threshold: 0.7,
    score: (p) => matchNames(full(p.a), full(p.b)).percentage / 100,
  },
  {
    name: "person-name-match",
    score: (p) =>
      namesFuzzyMatch({ firstName: p.a.first || undefined, lastName: p.a.last }, full(p.b))
        .averageScore ?? 0,
  },
  { name: "humnaam", threshold: LIKELY, score: (p) => match(full(p.a), full(p.b)).score },
];

const load = async (set: string): Promise<Pair[]> =>
  (await Bun.file(`bench/pairs/${set}.jsonl`).text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

export function measure(scores: number[], pairs: Pair[], threshold: number) {
  let tp = 0,
    fp = 0,
    fn = 0;
  pairs.forEach((p, i) => {
    const said = scores[i]! >= threshold;
    if (said && p.match) tp++;
    else if (said) fp++;
    else if (p.match) fn++;
  });
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  return { precision, recall, f1: (2 * precision * recall) / (precision + recall || 1) };
}

if (import.meta.main) {
  const dev = await load("dev");
  // The test set is held back: it is read only when asked for, and nothing is tuned on it.
  const test = process.argv.includes("--test") ? await load("test") : undefined;
  const target = test ?? dev;
  const pct = (n: number) => (n * 100).toFixed(1);
  const rows = [];
  let breakdown = "";

  for (const m of matchers) {
    const devScores = dev.map(m.score);
    const scores = test ? test.map(m.score) : devScores;
    const cuts: [string, number | undefined][] = [["package default", m.threshold]];
    // Best F1 is useless here: calling every pair a match already wins it. So tune for recall at a fixed precision.
    for (const goal of [0.9, 0.95]) {
      let tuned: number | undefined;
      for (let i = 100; i >= 0; i--) {
        const r = measure(devScores, dev, i / 100);
        if (r.recall > 0 && r.precision >= goal) tuned = i / 100;
      }
      cuts.push([`${goal * 100}% precision on dev`, tuned]);
    }
    for (const [kind, t] of cuts) {
      if (t === undefined) {
        if (kind !== "package default")
          rows.push({
            matcher: m.name,
            threshold: `none reaches ${kind}`,
            precision: "-",
            recall: "-",
            f1: "-",
          });
        continue;
      }
      const r = measure(scores, target, t);
      rows.push({
        matcher: m.name,
        threshold: `${t.toFixed(2)} (${kind})`,
        precision: pct(r.precision),
        recall: pct(r.recall),
        f1: pct(r.f1),
      });
    }
    if (m.name === "humnaam" && !test) {
      const rate = (kind: string) => {
        const ps = dev
          .map((p, i) => [p, devScores[i]!] as const)
          .filter(([p]) => (kind === "alias" ? p.match : p.kind === kind));
        return pct(ps.filter(([, s]) => s >= LIKELY).length / ps.length);
      };
      breakdown = `humnaam at ${LIKELY}: recall on matches ${rate("alias")}, false positives on same-surname ${rate("same-surname")}, on same-first-name ${rate("same-first-name")}`;
    }
  }

  const matches = target.filter((p) => p.match).length;
  console.log(
    `${test ? "test" : "dev"} set: ${matches} matches, ${target.length - matches} non-matches`,
  );
  console.log(
    `calling every pair a match scores precision ${pct(matches / target.length)}, recall 100.0`,
  );
  console.table(rows);
  if (breakdown) console.log(breakdown);
}
