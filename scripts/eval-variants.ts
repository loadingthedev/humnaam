// Validates variantKey on public transliteration data: Latin spellings attested for the same native word are variants.
// Dakshina v1.0 (Google, CC BY-SA 4.0): hi and ur romanization lexicons; the rules in src/index.ts were chosen on its build split.
// Aksharantar (AI4Bharat, CC BY / CC0): hin and urd, its Dakshina-sourced rows left out; never looked at while choosing rules.
// Nothing from either dataset is shipped. Run: bun run eval:variants
import { variantKey } from "../src/index";

const DAKSHINA = "data/dakshina/dakshina_dataset_v1.0";
const AKSHARANTAR = "data/aksharantar";

type Group = { lang: string; native: string; spellings: Map<string, number> };

async function download() {
  if (!(await Bun.file(`${DAKSHINA}/hi/lexicons/hi.translit.sampled.train.tsv`).exists())) {
    console.error("streaming the 2 GB Dakshina tar, keeping only the hi and ur lexicons…");
    await Bun.$`mkdir -p data/dakshina && curl -sfL https://storage.googleapis.com/gresearch/dakshina/dakshina_dataset_v1.0.tar | tar -x -C data/dakshina -f - '*/hi/lexicons/*' '*/ur/lexicons/*'`;
  }
  for (const l of ["hin", "urd"]) {
    if (await Bun.file(`${AKSHARANTAR}/${l}/${l}_train.json`).exists()) continue;
    await Bun.$`mkdir -p ${AKSHARANTAR} && curl -sfL -o ${AKSHARANTAR}/${l}.zip https://huggingface.co/datasets/ai4bharat/Aksharantar/resolve/main/${l}.zip && unzip -o -q ${AKSHARANTAR}/${l}.zip -d ${AKSHARANTAR}/${l}`;
  }
}

function add(
  groups: Map<string, Group>,
  lang: string,
  native: string,
  latin: string,
  count: number,
) {
  latin = latin.toLowerCase();
  if (!native || !/^[a-z]+$/.test(latin)) return;
  const k = `${lang}:${native}`;
  let g = groups.get(k);
  if (!g) groups.set(k, (g = { lang, native, spellings: new Map() }));
  g.spellings.set(latin, (g.spellings.get(latin) ?? 0) + count);
}

async function loadDakshina() {
  const groups = new Map<string, Group>();
  for (const lang of ["hi", "ur"])
    for (const split of ["train", "dev", "test"])
      for (const line of (
        await Bun.file(`${DAKSHINA}/${lang}/lexicons/${lang}.translit.sampled.${split}.tsv`).text()
      ).split("\n")) {
        const [native, latin, count] = line.split("\t");
        if (native && latin) add(groups, lang, native, latin, Number(count) || 1);
      }
  return [...groups.values()];
}

async function loadAksharantar() {
  const groups = new Map<string, Group>();
  const nei: Record<string, number> = {};
  for (const lang of ["hin", "urd"])
    for (const split of ["train", "valid", "test"])
      for (const line of (
        await Bun.file(`${AKSHARANTAR}/${lang}/${lang}_${split}.json`).text()
      ).split("\n")) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (row.source === "AK-NEI") nei[lang] = (nei[lang] ?? 0) + 1;
        if (row.source !== "Dakshina" && typeof row["english word"] === "string")
          add(groups, lang, row["native word"], row["english word"], 1);
      }
  return { groups: [...groups.values()], nei };
}

// FNV-1a over the native word, so a word (and every spelling of it) lands in one split in both datasets.
function heldOut(native: string) {
  let h = 2166136261;
  for (const c of native) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return (h >>> 0) % 5 === 0;
}

function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length]!;
}

function deletions(s: string, depth: number): Set<string> {
  const out = new Set([s]);
  for (let d = 0; d < depth; d++)
    for (const t of [...out])
      for (let i = 0; i < t.length; i++) out.add(t.slice(0, i) + t.slice(i + 1));
  return out;
}

const pct = (hit: number, n: number) =>
  `${((100 * hit) / n).toFixed(2)}% (${hit.toLocaleString("en")} of ${n.toLocaleString("en")})`;

function evaluate(name: string, groups: Group[]) {
  const same = (pairs: [string, string][]) =>
    pct(pairs.filter(([a, b]) => variantKey(a) === variantKey(b)).length, pairs.length);
  const variants: [string, string][] = [];
  const attested: [string, string][] = [];
  for (const g of groups) {
    const s = [...g.spellings];
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) {
        variants.push([s[i]![0], s[j]![0]]);
        if (s[i]![1] > 1 && s[j]![1] > 1) attested.push([s[i]![0], s[j]![0]]);
      }
  }
  // A negative pairs spellings of two different native words of one language; no native word may have both spellings.
  const random: [string, string][] = [];
  let hard = 0,
    hardSame = 0;
  let seed = 1;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  for (const lang of new Set(groups.map((g) => g.lang))) {
    const owners = new Map<string, Set<number>>();
    groups.forEach(
      (g, gi) =>
        g.lang === lang &&
        g.spellings.forEach((_, s) => (owners.get(s) ?? owners.set(s, new Set()).get(s)!).add(gi)),
    );
    const spellings = [...owners.keys()];
    const negative = (a: string, b: string) =>
      a !== b &&
      !owners
        .get(a)!
        .values()
        .some((g) => owners.get(b)!.has(g));
    for (let n = 0; n < 100_000;) {
      const a = spellings[Math.floor(rand() * spellings.length)]!,
        b = spellings[Math.floor(rand() * spellings.length)]!;
      if (negative(a, b)) (random.push([a, b]), n++);
    }
    // Two spellings within edit distance 2 share a string after at most two deletions from each.
    const index = new Map<string, string[]>();
    for (const s of spellings)
      for (const d of deletions(s, 2)) (index.get(d) ?? index.set(d, []).get(d)!).push(s);
    for (const a of spellings) {
      const near = new Set<string>();
      for (const d of deletions(a, 2)) for (const b of index.get(d)!) if (b > a) near.add(b);
      for (const b of near) {
        if (!negative(a, b) || editDistance(a, b) > 2) continue;
        hard++;
        if (variantKey(a) === variantKey(b)) hardSame++;
      }
    }
  }
  console.log(`\n${name}: ${groups.length.toLocaleString("en")} native words`);
  console.log(`  variant pairs with the same key:                     ${same(variants)}`);
  if (attested.length)
    console.log(`    both spellings attested at least twice:           ${same(attested)}`);
  console.log(`  different-word pairs wrongly sharing a key, random:  ${same(random)}`);
  console.log(
    `  different-word pairs wrongly sharing a key, edit distance <= 2: ${pct(hardSame, hard)}`,
  );
}

// How often replacing x by y turns one attested spelling into another of the same word, against into one of a different word.
function evidence(groups: Group[], rules: [string, string][]) {
  const owners = new Map<string, Set<number>>();
  groups.forEach((g, gi) =>
    g.spellings.forEach((_, s) =>
      (
        owners.get(`${g.lang}:${s}`) ??
        owners.set(`${g.lang}:${s}`, new Set()).get(`${g.lang}:${s}`)!
      ).add(gi),
    ),
  );
  console.log(
    "\nrule evidence on the Dakshina build split (same word / different word, by position):",
  );
  for (const [x, y] of rules) {
    const counts: Record<string, [number, number]> = {
      initial: [0, 0],
      medial: [0, 0],
      final: [0, 0],
    };
    groups.forEach((g, gi) =>
      g.spellings.forEach((_, s) => {
        for (let i = s.indexOf(x); i >= 0; i = s.indexOf(x, i + 1)) {
          const t = s.slice(0, i) + y + s.slice(i + x.length);
          const o = owners.get(`${g.lang}:${t}`);
          if (!o) continue;
          counts[i === 0 ? "initial" : i + x.length === s.length ? "final" : "medial"]![
            o.has(gi) ? 0 : 1
          ]++;
        }
      }),
    );
    console.log(
      `  ${`${x || "∅"} → ${y || "∅"}`.padEnd(9)} ${Object.entries(counts)
        .map(([p, [v, c]]) => `${p} ${v}/${c}`.padEnd(20))
        .join("")}`,
    );
  }
}

await download();
const dakshina = await loadDakshina();
const aksharantar = await loadAksharantar();
console.log(
  `Dakshina entries: ${dakshina.reduce((n, g) => n + g.spellings.size, 0).toLocaleString("en")} spellings of ${dakshina.length.toLocaleString("en")} native words (hi + ur)`,
);
console.log(`Aksharantar AK-NEI rows: hin ${aksharantar.nei.hin}, urd ${aksharantar.nei.urd}`);
evidence(
  dakshina.filter((g) => !heldOut(g.native)),
  [
    ["ph", "f"],
    ["q", "k"],
    ["kh", "k"],
    ["z", "j"],
    ["gh", "g"],
    ["th", "t"],
    ["dh", "d"],
    ["w", "v"],
    ["ee", "i"],
    ["oo", "u"],
    ["aa", "a"],
    ["a", ""],
    ["e", ""],
    ["i", ""],
    ["o", ""],
    ["u", ""],
    ["o", "u"],
    ["e", "a"],
    ["e", "i"],
    ["ai", ""],
    ["ai", "a"],
    ["ah", "a"],
    ["y", "i"],
    ["ey", "e"],
  ],
);
evaluate(
  "Dakshina build split (rules chosen here)",
  dakshina.filter((g) => !heldOut(g.native)),
);
evaluate(
  "Dakshina held-out split",
  dakshina.filter((g) => heldOut(g.native)),
);
evaluate(
  "Aksharantar held-out split, words with 2+ spellings",
  aksharantar.groups.filter((g) => heldOut(g.native) && g.spellings.size > 1),
);
