import { createHash } from "node:crypto";

export type Name = { first: string; last: string };
export type Person = { uid: number; name: Name; aliases: Name[] };
export type Pair = {
  kind: "alias" | "same-surname" | "same-first-name";
  match: boolean;
  a: Name;
  b: Name;
  uidA: number;
  uidB: number;
};

const SDN_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const RAW = "data/ofac/SDN.XML";
const OUT = "bench/pairs";
// Caps the weight of very common names (61 people are named KIM).
const NEGATIVES_PER_PERSON = 10;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const tag = (xml: string, name: string) =>
  decode(xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? "").trim();

// Element names follow OFAC's XML.xsd: sdnEntry > firstName, lastName, sdnType, akaList > aka > type, category.
export function parseSdn(xml: string): Person[] {
  const people: Person[] = [];
  for (const [, entry] of xml.matchAll(/<sdnEntry>([\s\S]*?)<\/sdnEntry>/g)) {
    if (!entry || tag(entry, "sdnType") !== "Individual") continue;
    const akas = [...entry.matchAll(/<aka>([\s\S]*?)<\/aka>/g)].map((m) => m[1]!);
    // The entry's own name must not be read from inside an alias.
    const own = entry.replace(/<akaList>[\s\S]*?<\/akaList>/, "");
    people.push({
      uid: Number(tag(own, "uid")),
      name: { first: tag(own, "firstName"), last: tag(own, "lastName") },
      // f.k.a. and n.k.a. are different names by definition; weak aliases are loose nicknames.
      aliases: akas
        .filter((a) => tag(a, "type") === "a.k.a." && tag(a, "category") === "strong")
        .map((a) => ({ first: tag(a, "firstName"), last: tag(a, "lastName") })),
    });
  }
  return people;
}

export const full = (n: Name) => [n.first, n.last].filter(Boolean).join(" ");
const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const hash = (s: string) => createHash("sha1").update(s).digest("hex");

// Split by surname, so one person and one surname group never sit in both sets.
const inTest = (last: string) => parseInt(hash(key(last)).slice(0, 8), 16) % 5 === 0;
export const isTest = (p: Pair) => inTest(p.a.last);

export function buildPairs(people: Person[]): Pair[] {
  const pairs: Pair[] = [];
  const bySurname = new Map<string, Person[]>();
  const byFirstName = new Map<string, Person[]>();
  const add = (map: Map<string, Person[]>, k: string, p: Person) =>
    k && map.set(k, [...(map.get(k) ?? []), p]);

  for (const p of people) {
    const seen = new Set([key(full(p.name))]);
    for (const alias of p.aliases) {
      const k = key(full(alias));
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ kind: "alias", match: true, a: p.name, b: alias, uidA: p.uid, uidB: p.uid });
    }
    add(bySurname, key(p.name.last), p);
    add(byFirstName, key(p.name.first), p);
  }

  const done = new Set<string>();
  const groups = [
    ["same-surname", bySurname],
    ["same-first-name", byFirstName],
  ] as const;
  for (const [kind, map] of groups) {
    for (const group of map.values()) {
      for (const p of group) {
        const id = (q: Person) => [p.uid, q.uid].sort((x, y) => x - y).join("-");
        const others = group
          // Two people with the same full name cannot be told apart by name, so they are not a non-match.
          .filter((q) => q !== p && key(full(q.name)) !== key(full(p.name)))
          .filter((q) => inTest(q.name.last) === inTest(p.name.last))
          .sort((x, y) => hash(id(x)).localeCompare(hash(id(y))))
          .slice(0, NEGATIVES_PER_PERSON);
        for (const q of others) {
          if (done.has(id(q))) continue;
          done.add(id(q));
          pairs.push({ kind, match: false, a: p.name, b: q.name, uidA: p.uid, uidB: q.uid });
        }
      }
    }
  }
  return pairs;
}

if (import.meta.main) {
  if (!(await Bun.file(RAW).exists())) {
    const res = await fetch(SDN_URL);
    if (!res.ok) throw new Error(`OFAC download failed: ${res.status}`);
    await Bun.write(RAW, res);
  }
  const xml = await Bun.file(RAW).text();
  const people = parseSdn(xml);
  const pairs = buildPairs(people);
  const count = (ps: Pair[]) => ({
    matches: ps.filter((p) => p.match).length,
    nonMatches: ps.filter((p) => !p.match).length,
  });
  const jsonl = (ps: Pair[]) => ps.map((p) => JSON.stringify(p)).join("\n") + "\n";
  const dev = pairs.filter((p) => !isTest(p));
  const test = pairs.filter(isTest);
  const source = {
    url: SDN_URL,
    publishDate: tag(xml, "Publish_Date"),
    sha256: createHash("sha256").update(xml).digest("hex"),
    individuals: people.length,
    dev: count(dev),
    test: count(test),
  };
  await Bun.write(`${OUT}/dev.jsonl`, jsonl(dev));
  await Bun.write(`${OUT}/test.jsonl`, jsonl(test));
  await Bun.write(`${OUT}/source.json`, JSON.stringify(source, null, 2) + "\n");
  console.log(source);
}
