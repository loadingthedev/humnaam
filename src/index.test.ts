import { expect, test } from "bun:test";
import { LIKELY, match, normalize, variantKey } from "./index";

test.each([
  ["  Dr.  Ayman AL-ZAWAHIRI ", ["ayman", "al", "zawahiri"]],
  ["'Abd al-Hamid AL-MU'AJJAL", ["abd", "al", "hamid", "al", "muajjal"]],
  ["Fahad H.A. AL-KHOSIBAN", ["fahad", "h", "a", "al", "khosiban"]],
  ["Ruben Pestano, Jr. LAVILLA", ["ruben", "pestano", "lavilla"]],
  ["Shri A. K. Sharma", ["a", "k", "sharma"]],
  ["Shakeel SHEIKH", ["shakeel", "sheikh"]],
  ["Sheikh Shakeel AHMED", ["shakeel", "ahmed"]],
  ["José García", ["jose", "garcia"]],
  ["", []],
])("normalize(%p)", (name, words) => {
  expect(normalize(name)).toEqual(words);
});

test.each([
  "mohammed muhammad mohamed muhammed mohammad mohd md",
  "chaudhary choudhury chowdhury chaudhari chodhary",
  "hussain hussein husayn husain",
  "qasmi kasmi qaasmi qasimi",
  "yusuf yousuf yousef",
  "rahman rehman rahmaan",
  "usman osman",
  "ali aly alee",
  "aliya alia aaliyah",
  "pandey pande",
  "fatima fatimah fatma",
  "farooq farook faruq pharuk",
  "zahid jahid",
  "hasan hassan",
])("variantKey gives one key to %p", (words) => {
  expect(new Set(words.split(" ").map((w) => variantKey(w))).size).toBe(1);
});

test.each([
  ["ali", "alia"],
  ["hasan", "hussain"],
  ["khan", "kan"],
  ["ghasemi", "qasemi"],
  ["umar", "amar"],
  ["shah", "sah"],
  ["sana", "sani"],
  ["ali", "عليّ"],
  ["", "a"],
])("variantKey keeps %p and %p apart", (a, b) => {
  expect(variantKey(a)).not.toBe(variantKey(b));
});

test("variantKey reads hand-written abbreviations only, not object keys", () => {
  expect(variantKey("constructor")).toBe(variantKey("konstruktor"));
});

const score = (a: string, b: string) => match(a, b).score;

test.each([
  ["Mohammed Khan", "Muhammad Khaan"],
  ["Mohd Aftab Khan", "Mohammed Aftab Khan"],
  ["Rahul Chaudhary", "Rahul Choudhury"],
  ["Ali Qasemi", "Ali Ghasemi"],
  ["Uthman Ali", "Usman Ali"],
  ["M. A. Khan", "Mohammed Aftab Khan"],
  ["Khan Mohammed Aftab", "Mohammed Aftab Khan"],
  ["Abdul Rahman", "Abdulrahman"],
  ["Abd al-Rahman", "Abdulrahman"],
  ["Abdur Rahman", "Abdulrahman"],
  ["Abd al-Rahman", "Abdur Rahman"],
  ["Al Tikriti", "Altikriti"],
  ["Ali Hasan", "Ali Alhassan"],
  ["Jamal al-Din", "Jamaluddin"],
  ["Mohammed Aftab Khan", "Mohammed Khan"],
  ["Ayman al-Zawahiri", "Ayman Zawahiri"],
])("%p and %p are a likely match", (a, b) => {
  expect(score(a, b)).toBeGreaterThanOrEqual(LIKELY);
});

test.each([
  ["Mohammed Khan", "Mohammed Hussain"],
  ["Muhammad Ali", "Muhammad Hussain Shah"],
  ["Mohammed", "Mohammed Aftab Khan"],
  ["Abd-al-Hamid al-Masli", "Hamza Darnavi"],
])("%p and %p are not a likely match", (a, b) => {
  expect(score(a, b)).toBeLessThan(LIKELY);
});

test.each([
  // Same key and close spelling beat same key alone.
  [
    ["Mohammed Khan", "Muhammad Khan"],
    ["Mohammed Khan", "Mahmood Khan"],
  ],
  [
    ["Hamid Khan", "Hameed Khan"],
    ["Hamid Khan", "Hamad Khan"],
  ],
  // A near miss the key does not join counts, below a key match.
  [
    ["Ali Qasimi", "Ali Kasimi"],
    ["Ali Qasemi", "Ali Ghasemi"],
  ],
  [
    ["Ali Ghasemi", "Ali Qasemi"],
    ["Ali Ghasemi", "Ali Hashemi"],
  ],
  // An initial is weaker than the full word.
  [
    ["Mohammed Khan", "Mohammed Khan"],
    ["M. Khan", "Mohammed Khan"],
  ],
  [
    ["M. Khan", "Mohammed Khan"],
    ["M. Khan", "Hussain Khan"],
  ],
  // A missing word costs much less than a clearly different one.
  [
    ["Mohammed Aftab Khan", "Mohammed Khan"],
    ["Mohammed Aftab Khan", "Mohammed Hussain Khan"],
  ],
  [
    ["Mohammed Aftab Khan", "Mohammed Khan"],
    ["Mohammed", "Mohammed Aftab Khan"],
  ],
  // An initial in order with the full words counts; out of order it counts less.
  [
    ["M. Saeed", "Muhammad Saeed"],
    ["M. Saeed", "Saeed Mortazavi"],
  ],
  // A missing particle costs less than a missing name.
  [
    ["Ayman al-Zawahiri", "Ayman Zawahiri"],
    ["Ayman Rabi al-Zawahiri", "Ayman al-Zawahiri"],
  ],
])("%p scores above %p", (x, y) => {
  expect(score(x[0]!, x[1]!)).toBeGreaterThan(score(y[0]!, y[1]!));
});

test("a common given name alone does not carry a pair", () => {
  for (const name of ["Muhammad", "Ali", "Ahmad"])
    expect(score(`${name} Rashid`, `${name} Qureshi`)).toBeLessThan(0.3);
});

test("word order costs nothing but is reported", () => {
  const m = match("Khan Aftab", "Aftab Khan");
  expect(m.score).toBe(1);
  expect(m.reordered).toBe(true);
  expect(match("Aftab Khan", "Aftab Khan").reordered).toBe(false);
});

test("parts and reason say how the words paired", () => {
  const m = match("Mohd K. Ali", "Muhammad Khan");
  expect(m.parts).toEqual([
    { a: "mohd", b: "muhammad", how: "short" },
    { a: "k", b: "khan", how: "initial" },
    { a: "ali", how: "missing" },
  ]);
  expect(m.reason).toBe(
    "mohd is short for muhammad; k is the initial of khan; ali has no counterpart",
  );
  expect(match("Muhamad Imran", "Mohd Imran").reason).toBe("mohd is short for muhamad");
  expect(match("Abdul Rahman", "Abdulrahman").parts).toEqual([
    { a: "abdul rahman", b: "abdulrahman", how: "joined" },
  ]);
  expect(match("Mohammed Khan", "Mohammed Hussain").parts).toEqual([
    { a: "mohammed", b: "mohammed", how: "same" },
    { a: "khan", b: "hussain", how: "different" },
  ]);
});

test.each([
  ["Mohammed Aftab Khan", "M. A. Khan"],
  ["Abd al-Rahman", "Abdur Rahman"],
  ["Ali Ali Hasan", "Hasan Ali"],
  ["Mohammed Khan", "Mohammed Hussain"],
  ["Jamal al-Din", "Jamaluddin Ahmad"],
])("match is symmetric for %p and %p", (a, b) => {
  expect(score(a, b)).toBe(score(b, a));
});

test.each([
  "Mohammed Aftab Khan",
  "Muhammad Muhammad Salim",
  "'Abd al-Rahman AL-HUSAYN",
  "H.A. Khan",
  "Kim Kim",
])("%p matches itself fully", (name) => {
  expect(score(name, name)).toBe(1);
});

test("only names with the same words score 1", () => {
  expect(score("Usama bin Laden", "Laden Usama Bin")).toBe(1);
  for (const [a, b] of [
    ["Hassan", "Hasan"],
    ["Oussama Bin Laden", "Usama Bin Laden"],
    ["Mohd Imran", "Muhammad Imran"],
    ["Abdul Rahman", "Abdulrahman"],
  ])
    expect(score(a!, b!)).toBeLessThan(1);
});

test("the place of an unmatched word does not change the score", () => {
  expect(score("Tariq Mehmood", "Haji Mehmood")).toBe(score("Mehmood Tariq", "Haji Mehmood"));
  expect(score("Tariq Mehmood", "Haji Mehmood")).toBeLessThan(LIKELY);
  expect(score("Ayaan Ahmed Qureshi", "Ayaan Qureshi")).toBe(
    score("Ahmed Ayaan Qureshi", "Ayaan Qureshi"),
  );
});

// Ranks made-up names against a query as a search box would.
const rank = (query: string, names: string[]) =>
  names.map((name) => ({ name, score: score(query, name) })).sort((x, y) => y.score - x.score);

test.each([
  // A loose likeness of different length or consonants is not a near miss.
  ["Faisal bin Rashid", "Faisal Bin Rashid Al-Maktoum", ["Faisal Rahman", "Faisal Radwan"]],
  ["Bilal Haqqani", "Bilal Ahmed Haqqani", ["Bilal Hassan", "Bilal Hussain"]],
  ["Sohail Kazmi", "Sohail Kazimi", ["Sohail Kasim", "Sohail Karim"]],
  ["Nizamuddin Farooqi", "Nizamuddin Farooqui", ["Hassan Nizameddine"]],
  ["Ahmed Hussain", "Ahmad Hussain", ["Ahmad Ihsan", "Ahmad Ehsan"]],
  ["Zainab Akhtar", "Zainab Akhtar", ["Zainab Asghar", "Zaynab Arshad"]],
  // Initials alone, or out of order, do not carry a name.
  ["Yusuf Qadri", "Yusuf Qadri", ["Y.Q. Noorani", "Y. Noorani"]],
  ["S. Imran Baig", "Syed Imran Baig", ["Imran Siddiqui"]],
  // One shared word against a two-word name is not likely in either order.
  ["Tariq Mehmood", "Tariq Mahmood", ["Haji Mehmood", "Tariq"]],
  ["Mehmood Tariq", "Tariq Mahmood", ["Haji Mehmood", "Tariq"]],
  // A true match missing a middle word beats a wrong name of the same length.
  ["Ayaan Qureshi", "Ayaan Ahmed Qureshi", ["Ayan Khurshid", "Ayaan Jafri"]],
] as const)("%p ranks %p first and keeps wrong names below LIKELY", (query, best, wrong) => {
  expect(rank(query, [...wrong, best, "Imran Zaheer", "Mohammed Aftab Khan"])[0]!.name).toBe(best);
  for (const w of wrong) expect(score(query, w)).toBeLessThan(LIKELY);
});

test("a spelling variant ranks below the exact name", () => {
  const ranked = rank("Oussama Bin Laden", [
    "Usama Bin Laden",
    "Oussama Bin Laden",
    "Osama Bin Ladin",
  ]);
  expect(ranked.map((r) => r.name)).toEqual([
    "Oussama Bin Laden",
    "Usama Bin Laden",
    "Osama Bin Ladin",
  ]);
  expect(ranked[1]!.score).toBeLessThan(1);
});

test("an empty name scores 0", () => {
  expect(score("", "Mohammed Khan")).toBe(0);
  expect(score("Mohammed Khan", "")).toBe(0);
  expect(score("Dr.", "Mohammed")).toBe(0);
});
