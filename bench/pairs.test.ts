import { expect, test } from "bun:test";
import { buildPairs, full, isTest, parseSdn, type Pair } from "./pairs";
import { measure } from "./run";

const aka = (type: string, category: string, first: string, last: string) =>
  `<aka><uid>9</uid><type>${type}</type><category>${category}</category><lastName>${last}</lastName><firstName>${first}</firstName></aka>`;
const entry = (uid: number, type: string, first: string, last: string, akas = "") =>
  `<sdnEntry><uid>${uid}</uid><firstName>${first}</firstName><lastName>${last}</lastName><sdnType>${type}</sdnType><akaList>${akas}</akaList></sdnEntry>`;

const xml = [
  entry(
    1,
    "Individual",
    "Muhammad",
    "KHAN",
    [
      aka("a.k.a.", "strong", "Mohammed", "KHAN"),
      aka("a.k.a.", "strong", "MUHAMMAD", "Khan"),
      aka("a.k.a.", "weak", "Abu", "ALI"),
      aka("f.k.a.", "strong", "Old", "NAME"),
    ].join(""),
  ),
  entry(2, "Individual", "Imran", "KHAN"),
  entry(3, "Individual", "Muhammad", "Khan"),
  entry(4, "Entity", "", "KHAN &amp; SONS", aka("a.k.a.", "strong", "", "KHAN TRADING")),
].join("");

test("parses individuals with their strong a.k.a. names only", () => {
  const people = parseSdn(xml);
  expect(people.map((p) => p.uid)).toEqual([1, 2, 3]);
  expect(people[0]!.name).toEqual({ first: "Muhammad", last: "KHAN" });
  expect(people[0]!.aliases.map(full)).toEqual(["Mohammed KHAN", "MUHAMMAD Khan"]);
});

test("builds matches from aliases and non-matches from shared surnames", () => {
  const pairs = buildPairs(parseSdn(xml));
  const names = (match: boolean) =>
    pairs.filter((p) => p.match === match).map((p) => [full(p.a), full(p.b)].sort().join(" | "));
  // The alias that only differs in case is dropped; so is the pair of two people with the same name.
  expect(names(true)).toEqual(["Mohammed KHAN | Muhammad KHAN"]);
  expect(names(false).sort()).toEqual(["Imran KHAN | Muhammad KHAN", "Imran KHAN | Muhammad Khan"]);
  expect(new Set(pairs.map(isTest)).size).toBe(1);
});

test("measures precision and recall at a threshold", () => {
  const pairs = [true, true, false, false].map((match) => ({ match }) as Pair);
  expect(measure([0.9, 0.2, 0.8, 0.1], pairs, 0.5)).toEqual({
    precision: 0.5,
    recall: 0.5,
    f1: 0.5,
  });
});

test("reads a model answer strictly", async () => {
  const { parse } = await import("./llm");
  expect(parse({ answers: { same: { type: "noul", noul: 0.96 } } })).toBe(0.96);
  expect(parse({ answers: { same: { type: "noul", noul: "yes" } } })).toBeNull();
  expect(parse({ answers: { same: { type: "choice", choice: "yes" } } })).toBeNull();
  expect(parse({ answers: {} })).toBeNull();
});
