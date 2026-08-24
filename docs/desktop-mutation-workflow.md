# Desktop app: mutation testing workflow

Mutation testing **evaluates your tests**: it mutates source code and checks whether tests fail. Surviving mutants mean the tests run the code but don't assert on that behavior. Use this workflow to find and fix **weak tests**. Get reasonable coverage first (see coverage report); then use mutation to check that tests actually catch bugs.

## When to run mutation

Run mutation **mainly when tests change** (new or updated tests). That's when you want to know "do my tests actually assert on the right behavior?" You can also run it when you change source code to find gaps, but the primary trigger is test changes — mutation is about testing the tests, not replacing normal test runs.

## 1. Run mutation and generate reports

From repo root:

```bash
make mutation
```

This runs Stryker and then generates:

- **`reports/mutation/mutation.html`** — full report (all mutants, coverage, which tests ran).
- **`reports/mutation-follow-up.md`** — checklist of **Survived** mutants only (where to strengthen assertions). NoCoverage is omitted; use the coverage report for that.

## 2. Identify weak tests

From the repo root:

```bash
npm run mutation:weak-tests
```

This reads `reports/mutation/mutation.json` and lists tests that **only cover Survived mutants** (they never kill any mutant). Those tests execute code but don't assert on the behavior that would catch the mutation — they are the best candidates to improve.

Output is sorted by how often each test appears as the only cover of a Survived mutant (higher = more impact if you strengthen that test).

## 3. Improve tests

For each Survived mutant you want to fix:

1. **Location** — Use `reports/mutation-follow-up.md` for file, line, mutator, and code snippet.
2. **Which tests to strengthen** — Open `reports/mutation/mutation.html`, go to the file and mutant; the report shows which tests **covered** that mutant (ran but didn’t fail). Those are the tests that need a stronger or additional assertion for that behavior.
3. **Change** — Add or tighten an assertion so that if the code were mutated (e.g. condition replaced with `false`, or `>=` with `>`), the test would fail. Prefer improving existing tests over adding many new ones.

Optional: run `npm run mutation:weak-tests` to see which tests are in the “never kill” list and prioritize those.

## 4. Confirm

Re-run mutation and check that the report updates:

```bash
make mutation
```

- **Survived** count should go down for the code you targeted.
- **`reports/mutation-follow-up.md`** will have fewer items.
- **`npm run mutation:weak-tests`** will list fewer (or different) weak tests if you strengthened the right ones.

## Summary

| Step | Command / artifact | Purpose |
|------|--------------------|---------|
| 1 | `make mutation` | Get mutation report and Survived checklist |
| 2 | `npm run mutation:weak-tests` (at the repo root) | List tests that never kill (only cover Survived) |
| 3 | Use follow-up + HTML report | Find Survived mutants and the tests that cover them; strengthen assertions |
| 4 | `make mutation` again | Confirm Survived and weak-test list shrink |

---

## Scoped and incremental runs

### One-time vs ongoing

- **One-time:** Run a full mutation (`make mutation`), fix all Survived mutants, and (optionally) commit or store the resulting report as a baseline.
- **Ongoing:** After that, run mutation when you add or change tests (and optionally when you change source). Use incremental mode (`make mutation-incremental`) so only changed code and tests are re-evaluated; the rest reuses the baseline.

### Mutating only specific files

Stryker mutates **source files**, not tests. You can limit which code is mutated via the `mutate` config (in `stryker.config.json`) or by passing a different config.

Examples:

- **Single file:**  
  `"mutate": ["src/main/upload/uploader.ts"]`
- **One directory:**  
  `"mutate": ["src/main/upload/**/*.ts"]`
- **Line range in one file:**  
  `"mutate": ["src/main/upload/uploader.ts:1-100"]`

With `coverageAnalysis: "perTest"` and `enableFindRelatedTests: true`, only tests that cover the mutated file(s) run for those mutants. So “run Stryker on specific code” = narrow `mutate`; the tests that run are then determined by coverage.

### Incremental mode

Use incremental mode so Stryker only re-mutates and re-tests **changed** code and reuses previous results for the rest.

From repo root:

```bash
# First run: full mutation, writes incremental baseline (e.g. reports/stryker-incremental.json)
make mutation

# Later runs: only changed code is re-mutated; rest comes from baseline
make mutation-incremental
```

You need a baseline first (one full run). Commit or keep the incremental report so later runs can reuse it. Stryker uses a file diff to decide what changed; with the Jest runner it can also take test file changes into account.

### Pre-push hook (incremental, planned)

A pre-push hook can run `make mutation-incremental` when the push includes **desktop test changes** (e.g. files under `` matching `**/*.test.ts`), since mutation is about validating tests. Add it only after cleaning up existing Survived mutants. Until then, run `make mutation-incremental` manually when you change tests.

---

## Equivalent / unkillable mutants

Some Survived mutants are **equivalent mutants**: the mutated code has the same observable behavior as the original, so no test can kill them (e.g. fallback `''` replaced with `"Stryker was here!"` where that value never affects any branch). These are not a shortcoming of the code or tests.

**Strategy:** Use Stryker pragma comments in source to ignore unkillable mutants at the line or block level (e.g. `// Stryker disable StringLiteral` ... `// Stryker restore`). If a pattern emerges (e.g. many equivalent survivors for one mutator type), consider a global exclusion for that mutator in `stryker.config.json` (`mutator.excludedMutations`).
