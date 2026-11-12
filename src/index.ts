const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "sir",
  "eng",
  "shri",
  "sri",
  "smt",
  "shrimati",
  "kumari",
  "janab",
  "sahib",
  "saheb",
  "sheikh",
  "sheik",
  "shaikh",
  "shaykh",
  "cheikh",
  "haji",
  "hajji",
  "hadji",
  "haj",
  "hajj",
  "maulana",
  "mawlana",
  "maulvi",
  "molvi",
  "mullah",
  "mulla",
  "mufti",
  "qari",
  "hafiz",
  "ustad",
  "ustaz",
  "gen",
  "general",
  "col",
  "colonel",
  "maj",
  "major",
  "capt",
  "captain",
  "lt",
  "brig",
]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii"]);

/** Splits a name into lower-case words, without punctuation, accents, titles or suffixes. */
export function normalize(name: string): string[] {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // An apostrophe stands for a sound inside a word ('Abd, Mu'ajjal), so it must not split the word.
    .replace(/['`‘’ʻʼʾʿ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  // Sheikh and Haji are also surnames, and a suffix cannot come first, so position decides.
  return words.filter(
    (w, i) => !(TITLES.has(w) && i < words.length - 1) && !(SUFFIXES.has(w) && i > 0),
  );
}

// Hand-written: abbreviations no transliteration data shows.
const ABBREVIATIONS = new Map(["md", "mohd", "muhd", "mhd"].map((a) => [a, "muhammad"]));

const finalVowels = (v: string) =>
  /^a+$/.test(v)
    ? "A"
    : /^(i+|ie)$/.test(v)
      ? "I"
      : /^(e+|ai|ei|ae|aie)$/.test(v)
        ? "E"
        : /^([ou]+|au)$/.test(v)
          ? "U"
          : v.toUpperCase();

/** Maps a normalised word to a key its transliteration variants share: Mohammed and Muhammad give "mhmd". */
export function variantKey(word: string): string {
  let s = (ABBREVIATIONS.get(word) ?? word)
    .replace(/ph/g, "f")
    .replace(/c(?!h)/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "j")
    .replace(/gh/g, "g")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/(.)\1+/g, "$1")
    .replace(/([aeiouy])h$/, "$1")
    // w and y after a vowel are vowels (ow, aw); y anywhere but first is a vowel (aly, husayn).
    .replace(/([aeiou])w(?![aeiou])/g, "$1u")
    .replace(/w/g, "v");
  s = (s.slice(0, 1) + s.slice(1).replace(/y/g, "i")).replace(/(.)\1+/g, "$1");
  // Latin spellings disagree most on vowels, so only the first, the last and the ai/ei diphthong survive.
  return s
    .replace(/^[aeiou]+/, (v) => (/^[ou]/.test(v) ? "U" : "A"))
    .replace(/[aeiou]+$/, finalVowels)
    .replace(/[aeiou]+/g, (v) => (v === "ai" || v === "ei" ? "E" : ""));
}

export type Part = {
  a?: string;
  b?: string;
  how: "same" | "spelling" | "short" | "initial" | "joined" | "close" | "different" | "missing";
};
export type Match = { score: number; parts: Part[]; reordered: boolean; reason: string };

// Chosen on bench/pairs/dev.jsonl: 0.04 above the piles of pairs with one conflicting word or one shared word, at 96.7% precision.
export const LIKELY = 0.26;

// Abu starts a kunya (Abu Ali, "father of Ali"), which aliases add and drop freely.
const PARTICLES = new Set([
  "al",
  "el",
  "ul",
  "ud",
  "ur",
  "ad",
  "ar",
  "as",
  "ash",
  "at",
  "az",
  "an",
  "bin",
  "ibn",
  "bint",
  "ben",
  "abu",
  "de",
  "del",
  "da",
  "la",
  "van",
  "von",
]);
// Pairs that transliterations swap freely cost little: Arabic has no e or o, so e stands for a or i and o for u.
// Upper case stands for one sound written with two letters: X kh, S sh, T th, D dh, G gh, C ch.
const CHEAP: Record<string, number> = {
  ae: 0.15,
  ei: 0.15,
  ou: 0.15,
  eo: 0.3,
  eu: 0.3,
  ao: 0.5,
  io: 0.8,
  kq: 0.3,
  ck: 0.2,
  cq: 0.3,
  Gg: 0.2,
  Gq: 0.3,
  Gk: 0.5,
  jz: 0.3,
  Dz: 0.3,
  Dd: 0.3,
  Ts: 0.3,
  Tt: 0.3,
  sz: 0.5,
  Ss: 0.5,
  CS: 0.5,
  Xk: 0.4,
  Xh: 0.4,
  vw: 0.2,
  fv: 0.5,
  bp: 0.5,
  dt: 0.6,
  Cj: 0.3,
  gh: 0.5,
  Cz: 0.5,
  jy: 0.3,
  Gh: 0.5,
  gq: 0.3,
};
const COST = new Float64Array(128 * 128).fill(1);
for (const [p, c] of Object.entries(CHEAP))
  COST[p.charCodeAt(0) * 128 + p.charCodeAt(1)] = COST[p.charCodeAt(1) * 128 + p.charCodeAt(0)] = c;
const INDEL = new Float64Array(128).fill(1);
for (const c of "aeiouhy") INDEL[c.charCodeAt(0)] = 0.5;
const code = (s: string, i: number) => Math.min(s.charCodeAt(i), 127);

// One symbol per sound, so the edit distance counts sounds rather than letters.
const prep = (w: string) => {
  const s = (ABBREVIATIONS.get(w) ?? w)
    .replace(/kh/g, "X")
    .replace(/sh/g, "S")
    .replace(/th/g, "T")
    .replace(/dh/g, "D")
    .replace(/gh/g, "G")
    .replace(/ph/g, "f")
    .replace(/ch/g, "C")
    .replace(/([aeiou])w(?![aeiou])/g, "$1u")
    .replace(/ee/g, "i")
    .replace(/oo|ou/g, "u")
    .replace(/au/g, "o");
  return (s.slice(0, 1) + s.slice(1).replace(/y/g, "i")).replace(/(.)\1+/g, "$1");
};

function distance(a: string, b: string): number {
  let prev = new Float64Array(b.length + 1),
    row = new Float64Array(b.length + 1);
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1]! + INDEL[code(b, j - 1)]!;
  for (let i = 1; i <= a.length; i++) {
    const x = code(a, i - 1),
      del = INDEL[x]!;
    row[0] = prev[0]! + del;
    for (let j = 1; j <= b.length; j++) {
      const y = code(b, j - 1);
      row[j] = Math.min(
        prev[j]! + del,
        row[j - 1]! + INDEL[y]!,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : COST[x * 128 + y]!),
      );
    }
    [prev, row] = [row, prev];
  }
  return prev[b.length]!;
}

type Word = { text: string; key: string; prep: string; weight: number };
// A search box matches the same names on every keystroke, so each word is prepared once; the cap bounds memory.
const cache = new Map<string, Word>();
const word = (text: string): Word => {
  let w = cache.get(text);
  if (!w) {
    if (cache.size >= 50_000) cache.clear();
    cache.set(
      text,
      (w = {
        text,
        key: variantKey(text),
        prep: prep(text),
        weight: PARTICLES.has(text) ? 0.2 : text.length === 1 ? 0.5 : 1,
      }),
    );
  }
  return w;
};

function strength(x: Word, y: Word): [number, Part["how"]] {
  if (x.text === y.text) return [1, "same"];
  if (x.text.length === 1 || y.text.length === 1) {
    const [i, w] = x.text.length === 1 ? [x, y] : [y, x];
    return w.text.length > 1 && w.weight === 1 && w.text[0] === i.text
      ? [0.75, "initial"]
      : [0, "different"];
  }
  const d = distance(x.prep, y.prep);
  // The key alone also joins Mohammed and Mahmood, so the spelling distance grades it.
  if (x.key === y.key)
    // Below 1 even at no distance: only identical words score 1.
    return [
      Math.min(0.95, Math.max(0.5, 1 - 0.3 * d)),
      ABBREVIATIONS.has(x.text) !== ABBREVIATIONS.has(y.text) ? "short" : "spelling",
    ];
  if (x.weight < 1 || y.weight < 1) return [0, "different"];
  const [short, long] = x.prep.length < y.prep.length ? [x.prep, y.prep] : [y.prep, x.prep];
  const cs = short.replace(/[aeiou]/g, ""),
    cl = long.replace(/[aeiou]/g, "");
  // Compound names keep their first part: Kamal and Kamaluddin, Hamid and Hamidreza.
  if (cs.length >= 3 && long.startsWith(short)) return [0.6, "close"];
  // A near miss needs most consonants to agree, and a short word may differ by little more than one sound.
  if (distance(cs, cl) > 0.44 * Math.max(cs.length, cl.length) || (d > 1.4 && long.length <= 6))
    return [0, "different"];
  const s = 1 - (1.6 * d) / long.length;
  // Without the key's support a near miss is weaker evidence than any spelling variant.
  return s >= 0.4 ? [0.85 * s, "close"] : [0, "different"];
}

const SUN = "tdrzsnl";
// Joined, the article is written ul or, before a sun letter, as that letter doubled: Abdulrahman, Abdurrahman, Jamaluddin.
const glue = (ws: string[], next = "") => {
  const after = (i: number) => (ws[i + 1] ?? next)[0] ?? "";
  const sun = (i: number) => after(i) !== "" && SUN.includes(after(i));
  const ul = ws.map((w, i) =>
    PARTICLES.has(w)
      ? "ul"
      : sun(i) && /[aeiu][tdrzsn]$/.test(w) && w.at(-1) === after(i)
        ? w.slice(0, -1) + "l"
        : w,
  );
  const assimilated = ws.map((w, i) =>
    !sun(i)
      ? PARTICLES.has(w)
        ? "ul"
        : w
      : PARTICLES.has(w)
        ? "u" + after(i)
        : /[aeiu]l$/.test(w)
          ? w.slice(0, -1) + after(i)
          : w,
  );
  return [...new Set([ws.join(""), ul.join(""), assimilated.join("")])].map(word);
};

type Run = { at: number[]; forms: Word[] };
// Runs of words, and words with al written on (Alhassan), that could be one word of the other name; only plausible lengths.
const runs = (ws: Word[], other: Word[]) => {
  const near = (len: number) =>
    other.some((x) => x.text.length >= 4 && Math.abs(x.text.length - len) <= 3);
  const out: Run[] = [];
  ws.forEach(
    (w, j) =>
      /^[ae]l/.test(w.text) &&
      w.text.length >= 6 &&
      near(w.text.length - 2) &&
      out.push({ at: [j], forms: [word(w.text.slice(2))] }),
  );
  for (let n = 2; n <= 3; n++)
    for (let j = 0; j + n <= ws.length; j++) {
      const run = ws.slice(j, j + n);
      if (run.some((w) => w.text.length === 1) || !near(run.reduce((t, w) => t + w.text.length, 0)))
        continue;
      out.push({
        at: run.map((_, k) => j + k),
        forms: glue(
          run.map((w) => w.text),
          ws[j + n]?.text,
        ),
      });
    }
  return out;
};

type Edge = { a: number[]; b: number[]; s: number; how: Part["how"]; w: number; tie: string };

/** Scores how likely two names are the same person's name, from 0 to 1, and says how their words pair up. */
export function match(a: string, b: string): Match {
  const A = normalize(a).map(word);
  const B = normalize(b).map(word);
  if (!A.length || !B.length)
    return { score: 0, parts: [], reordered: false, reason: "a name is empty" };
  const weight = (ws: Word[], is: number[]) => is.reduce((t, i) => t + ws[i]!.weight, 0);
  const text = (ws: Word[], is: number[]) => is.map((i) => ws[i]!.text).join(" ");
  const all: Edge[] = [];
  const add = (ia: number[], ib: number[], s: number, how: Part["how"]) =>
    all.push({
      a: ia,
      b: ib,
      s,
      how,
      w: weight(A, ia) + weight(B, ib),
      tie: [text(A, ia), text(B, ib)].sort().join("|"),
    });
  A.forEach((x, i) =>
    B.forEach((y, j) => {
      const [s, how] = strength(x, y);
      if (s > 0) add([i], [j], s, how);
    }),
  );
  for (const [X, R, flip] of [
    [A, runs(B, A), false],
    [B, runs(A, B), true],
  ] as const)
    X.forEach((x, i) => {
      for (const r of R) {
        const s =
          x.text.length < 4
            ? 0
            : Math.max(0, ...r.forms.filter((g) => g.key === x.key).map((g) => strength(x, g)[0]));
        if (s >= 0.7)
          flip ? add(r.at, [i], s * 0.95, "joined") : add([i], r.at, s * 0.95, "joined");
      }
    });
  // A particle pairing with a particle is worth little, so it goes last and cannot take a particle a joined pair needs.
  // Other ties go to the pair nearest the same position, so a name with a repeated word still pairs with itself in order.
  const minor = (e: Edge) => (e.w <= 0.4 ? 1 : 0);
  all.sort(
    (x, y) =>
      minor(x) - minor(y) ||
      y.s - x.s ||
      y.w - x.w ||
      x.a[0]! + x.b[0]! - y.a[0]! - y.b[0]! ||
      Math.abs(x.a[0]! - x.b[0]!) - Math.abs(y.a[0]! - y.b[0]!) ||
      (x.tie < y.tie ? -1 : x.tie > y.tie ? 1 : 0),
  );
  const usedA = new Set<number>(),
    usedB = new Set<number>();
  const chosen = all
    .filter((e) => {
      if (e.a.some((i) => usedA.has(i)) || e.b.some((j) => usedB.has(j))) return false;
      e.a.forEach((i) => usedA.add(i));
      e.b.forEach((j) => usedB.add(j));
      return true;
    })
    .sort((x, y) => x.a[0]! - y.a[0]!);
  // An initial is weak evidence: it needs a full word beside it, and out of order with the full words it is only a gap.
  const full = chosen.filter((e) => e.how !== "initial" && e.w >= 2);
  for (const e of chosen.filter((e) => e.how === "initial")) {
    if (!full.length) {
      chosen.splice(chosen.indexOf(e), 1);
      e.a.forEach((i) => usedA.delete(i));
      e.b.forEach((j) => usedB.delete(j));
    } else if (full.some((f) => (f.a[0]! - e.a[0]!) * (f.b[0]! - e.b[0]!) < 0)) e.s = 0;
  }
  const reordered = chosen.some((e, k) => k > 0 && e.b[0]! < chosen[k - 1]!.b[0]!);

  // Sums run per word in name order, so swapping the names cannot change the score even in the last bit.
  const [creditA, totalA, creditB, totalB] = [A, A, B, B].map((ws) => ws.map(() => 0)) as [
    number[],
    number[],
    number[],
    number[],
  ];
  const parts: (Part & { at: number })[] = chosen.map((e) => {
    // A weak pair also costs: a loose likeness must not lift a wrong name to the level of a missing word.
    const t = e.how === "close" ? 1 + 2 * (1 - e.s) : e.s === 0 ? 1.5 : 1;
    e.a.forEach((i) => ((creditA[i] = e.s * A[i]!.weight), (totalA[i] = A[i]!.weight * t)));
    e.b.forEach((j) => ((creditB[j] = e.s * B[j]!.weight), (totalB[j] = B[j]!.weight * t)));
    return { a: text(A, e.a), b: text(B, e.b), how: e.how, at: e.a[0]! };
  });
  // One shared full word is weak evidence, so then every other word weighs heavily, whatever its position.
  const missing = full.length <= 1 ? 8 : 1.5;
  const gap = (i?: number, j?: number) => {
    const both = i !== undefined && j !== undefined;
    // A word against a clearly different word is evidence of another person; a word with no counterpart is only a gap.
    if (i !== undefined) totalA[i] = A[i]!.weight * (both ? 7 : missing);
    if (j !== undefined) totalB[j] = B[j]!.weight * (both ? 7 : missing);
    parts.push({
      a: i === undefined ? undefined : A[i]!.text,
      b: j === undefined ? undefined : B[j]!.text,
      how: both ? "different" : "missing",
      at: i ?? A.length + j!,
    });
  };
  // Left-over particles are only gaps; the other left-over words conflict in pairs, full words first.
  const left = (ws: Word[], used: Set<number>, particle: boolean) =>
    ws
      .map((_, i) => i)
      .filter((i) => !used.has(i) && PARTICLES.has(ws[i]!.text) === particle)
      .sort((x, y) => ws[y]!.weight - ws[x]!.weight || x - y);
  const la = left(A, usedA, false),
    lb = left(B, usedB, false);
  for (let k = 0; k < Math.max(la.length, lb.length); k++) gap(la[k], lb[k]);
  left(A, usedA, true).forEach((i) => gap(i));
  left(B, usedB, true).forEach((j) => gap(undefined, j));
  parts.sort((x, y) => x.at - y.at);
  const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
  return {
    score: (sum(creditA) + sum(creditB)) / (sum(totalA) + sum(totalB)),
    parts: parts.map(({ at, ...p }) => p),
    reordered,
    reason: describe(parts, reordered),
  };
}

function describe(parts: Part[], reordered: boolean): string {
  const said = parts.flatMap((p) => {
    const [a, b] = [p.a ?? "", p.b ?? ""];
    if (p.how === "spelling") return [`${a} is a spelling of ${b}`];
    if (p.how === "short")
      return [ABBREVIATIONS.has(a) ? `${a} is short for ${b}` : `${b} is short for ${a}`];
    if (p.how === "close") return [`${a} is close to ${b}`];
    if (p.how === "initial")
      return [a.length === 1 ? `${a} is the initial of ${b}` : `${b} is the initial of ${a}`];
    if (p.how === "joined") {
      if (a.includes(" ") || b.includes(" "))
        return [`${a} is ${b} written ${a.includes(" ") ? "apart" : "together"}`];
      const [short, long] = a.length < b.length ? [a, b] : [b, a];
      return [`${short} is ${long} without ${long.slice(0, 2)}`];
    }
    if (p.how === "different") return [`${a} differs from ${b}`];
    if (p.how === "missing") return [`${a || b} has no counterpart`];
    return [];
  });
  if (reordered) said.push("the words are in another order");
  return said.length ? said.join("; ") : "the names are the same";
}
