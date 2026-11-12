# humnaam

Decides whether two person names are the same person's name, and says why. Built for South Asian and Arabic names written in Latin letters, where one name has many spellings: "Mohammed / Muhammad / Mohd", "Chaudhary / Choudhury", initials, swapped word order, missing middle names.

"Humnaam" means namesake in Hindi and Urdu. It is also spelled "hamnaam".

**[Try the demo](https://loadingthedev.github.io/humnaam/)**: type a name and see ranked matches with the reason for each.

    bun add humnaam

```ts
import { match, LIKELY } from "humnaam";

const m = match("Mohd Aftab Khan", "Mohammed Aftab Khan");
m.score; // 0.97
m.reason; // "mohd is short for mohammed"
m.score >= LIKELY; // true
```

No dependencies. Runs in the browser. 3 KB minified and gzipped. About 10 microseconds per comparison.

## What it handles

| First name      | Second name         | Score | Reason                                                  |
| --------------- | ------------------- | ----- | ------------------------------------------------------- |
| Mohd Aftab Khan | Mohammed Aftab Khan | 0.97  | mohd is short for mohammed                              |
| M. A. Khan      | Mohammed Aftab Khan | 0.85  | m is the initial of mohammed; a is the initial of aftab |
| Khan Aftab      | Aftab Khan          | 1.00  | the words are in another order                          |
| Abdul Rahman    | Abdulrahman         | 0.95  | abdul rahman is abdulrahman written apart               |
| Chaudhary       | Choudhury           | 0.66  | chaudhary is a spelling of choudhury                    |
| Mohammed Khan   | Mohammed Hussain    | 0.13  | khan differs from hussain                               |

## API

`match(a, b)` returns:

- `score`: 0 to 1. It is not a percentage of similarity. `LIKELY` (0.26) is the cut-off for a likely match; 1 means the same words, in any order.
- `parts`: how each word paired up. Each part has the word from each name and `how`: `same`, `spelling`, `short`, `initial`, `joined`, `close`, `different` or `missing`.
- `reordered`: the words matched in a different order.
- `reason`: the parts as one sentence.

`normalize(name)` returns the name as lower-case words, without punctuation, accents, titles (Dr, Shri, Sheikh, Haji) or suffixes (Jr).

`variantKey(word)` returns a key that spellings of the same name share: "mohammed" and "muhammad" both give `mhmd`.

## How it works

1. **Normalise.** Lower case, strip punctuation and accents, drop titles and suffixes, split initials.
2. **Key each word.** A set of rewrite rules reduces a word to a consonant skeleton, so spellings of one name share a key. The rules were chosen from counts on public transliteration data (see below), not from the benchmark.
3. **Pair the words.** Each pair of words gets a strength: the same word, a spelling variant (graded by a sound-aware edit distance, so Mohammed/Muhammad scores above Mohammed/Mahmood), an abbreviation (Mohd), an initial, a joined or split form (Abdul Rahman / Abdulrahman / Abdur Rahman), or a near miss. The strongest pairs are taken first, in any order.
4. **Score.** Matched words earn credit. A word with no counterpart costs a little; two left-over words facing each other cost much more, because that is evidence of a different person. When only one full word is shared, every other word costs heavily, so a common first name cannot carry a match alone. Particles such as al, bin and abu weigh little.

## Benchmark

    bun run bench            # the development set
    bun run bench -- --test  # the held-back test set
    bun run bench:pairs      # rebuild the pairs from the OFAC list

Held-back test set (1,662 matches, 1,289 non-matches). Each package at its own default cut-off:

| Matcher                   | Cut-off                               | Precision | Recall   | F1       |
| ------------------------- | ------------------------------------- | --------- | -------- | -------- |
| **humnaam**               | 0.26                                  | **97.2**  | **74.0** | **84.0** |
| name-match 1.0.4          | 0.75                                  | 81.4      | 68.8     | 74.6     |
| name-match-advanced 1.3.9 | 70                                    | 72.7      | 63.1     | 67.5     |
| fuzzy-names 4.8.1         | default                               | 51.4      | 54.0     | 52.7     |
| person-name-match 0.1.3   | none; 0.81 gives 90% precision on dev | 90.3      | 19.7     | 32.3     |

Calling every pair a match scores precision 56.3 and recall 100.

With each matcher's cut-off raised until it reaches 95% precision on the development set, recall on the test set is: humnaam 74.5, name-match 28.7, person-name-match 13.1, name-match-advanced 0.2. fuzzy-names never reaches it.

On the development set (6,871 matches, 6,521 non-matches) humnaam scores precision 96.7 and recall 76.6. Every weight and cut-off was tuned on the development set only. The test set was run twice: once after the first round of tuning (precision 96.2, recall 75.2), and once after a second round that fixed ranking errors found while building the demo. No change was made in response to a test result.

### Where the pairs come from

The individuals on the OFAC SDN list (US Treasury, `SDN.XML`, published 2026-11-09; checksum in `bench/pairs/source.json`).

- **Matches**: a person's main name against each of their strong "a.k.a." names. Weak aliases, "f.k.a." and "n.k.a." names are left out. Pairs that differ only in case or punctuation are left out.
- **Non-matches**: two different people who share a surname, or who share a first name, at most 10 per person of each kind. OFAC does not label these. We derive them.
- **Split**: by surname, about 80% development and 20% test. No person and no surname is in both sets.

### Limits of this benchmark

- Some strong aliases are a different name altogether (a nom de guerre). No name matcher should match them, so recall cannot reach 100%.
- Two different people can carry the same name in two spellings. Such a pair is counted as a non-match.
- The list covers all nationalities, not only South Asian and Arabic names. There is no separate score for those names yet.
- The development set holds a larger share of same-first-name pairs than the test set, so precision differs between the two.
- The benchmark was designed by the author of the library. The baselines were run as their documentation describes, without tuning beyond the cut-offs shown.

## Known weaknesses

- The key is coarse on vowels. Mohammed/Mahmood, Hamid/Hamad and Salim/Salam share a key; the edit distance pulls their score down (Mohammed Khan / Mahmood Khan scores 0.81) but not below the cut-off.
- An initial with one matching word is enough: "M Saeed" / "Saeed Mortazavi" is a likely match (0.47).
- A dropped word is cheap, so a father and a child who share a chain of names can match.
- Long names with one different word still pass ("Luis Hernando Gomez Bustamante" / "Luis Alfonso Gomez Bustamante" scores 0.30).
- The score is a ranking value, not a probability, and likely matches start low on its scale.
- Latin letters only. Devanagari and Arabic script are not matched.
- It compares names. It does not identify people: dates of birth, addresses and documents are out of scope.

## Variant rules and their data

The spelling rules were chosen and checked on two public transliteration datasets, where one native-script word has several attested Latin spellings:

- [Dakshina](https://github.com/google-research-datasets/dakshina) (Google, CC BY-SA 4.0), Hindi and Urdu lexicons.
- [Aksharantar](https://huggingface.co/datasets/ai4bharat/Aksharantar) (AI4Bharat, CC BY and CC0), Hindi and Urdu.

`bun run eval:variants` downloads them and prints the evidence for each rule. On held-out Dakshina words, 67.7% of pairs of spellings of the same word share a key (86.9% when both spellings were attested at least twice), and 1.3% of pairs of different words within two edits wrongly share one. The package ships hand-written rules only, and no data from either dataset.

## Development

    bun install
    bun test
    bun run format   # oxfmt
    bun run demo     # the demo page

## Licence

MIT
