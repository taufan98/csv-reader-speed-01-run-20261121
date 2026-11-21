# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/taufan98/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/taufan98/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, built for the make.fun competition [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121) ("Read broken CSV files faster, 21 November 2026"). It reads broken CSV files — stray CRs, quotes that never close, junk after a closing quote, short and long rows — and answers exactly as csv-reader does on every case, in about half the CPU time.

## Run it

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) reads every case from `/input/cases.json`, answers each with `run` from `solve.js`, and writes `/output/answers.json`. No network; deterministic — every run writes the same bytes.

## How it is faster

The reference reads one character at a time and builds every field a character at a time. This reader scans with native `indexOf` and slices whole fields at once:

- an unquoted field is one slice up to the next comma or LF (a CR in the span, or a CR just before the LF, is the only thing that diverts it to a slow path);
- a quoted field with no line break inside is one slice between its quotes, with `""` folded to one quote by a native `replaceAll` when there is one;
- only the rare broken shapes (stray CR, embedded line breaks, junk after a closing quote, an unterminated quote) fall back to segment-scanning helpers that still slice between specials instead of reading a character at a time.

On the kit's practice set (6 cases, ~10.2 MB of CSV): **6/6 answers identical** to csv-reader 1.0.0, at **~1.05 s CPU vs ~2.03 s** for the house baseline — about **1.9× faster**. Verified further by differential fuzzing: 732 random edge-case inputs and 24 fresh cases drawn by the kit's own generator, all byte-identical to the reference.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=va8excfs&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
