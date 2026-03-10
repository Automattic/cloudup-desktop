---
name: desktop-mutation
description: Run mutation testing for the desktop app (apps/desktop) when tests are added or updated. Validates that new or changed tests actually assert on behavior (kill mutants), not just execute code. Scope is the desktop app module only.
---

# Desktop Mutation Testing

Mutation testing **evaluates test quality**: Stryker mutates source code in `apps/desktop` and runs the test suite. If a mutant survives, the tests run that code but don't assert on the behavior that would catch the bug. Use this skill when you add or change desktop app tests to confirm they are effective.

**Scope**: Desktop app only (`apps/desktop/`). Other modules (PHP, websocket, etc.) are not in scope.

## When to Use

- After **adding or updating tests** in `apps/desktop/` (e.g. new or changed `*.test.ts` files)
- When you want to check that new tests actually kill mutants, not just increase coverage
- Optionally after changing desktop **source** code to find gaps (add coverage first, then run mutation)

Do **not** use this in place of normal test runs (`make desktop:test`). Mutation is for validating tests, not for every commit.

## Prerequisites

- Node.js >= 20.12.0 (see `apps/desktop/package.json` engines and `.nvmrc`)
- Desktop tests pass: `make desktop:test`
- Reasonable coverage for the code you care about (use coverage report first to add tests for uncovered code; then mutation to check test strength)

## Step 1: Run Mutation

From **repo root**:

```bash
# Full run (use when no baseline yet, or to refresh everything)
make desktop:mutation

# Incremental (faster; use when baseline exists and you only changed some code/tests)
make desktop:mutation-incremental
```

Incremental reuses previous results for unchanged code; only changed files and tests are re-evaluated. First time or after a long gap, use full `make desktop:mutation` to (re)build the baseline.

**Output**:

- `apps/desktop/reports/mutation/mutation.html` — full report (which tests ran, which mutants killed/survived)
- `apps/desktop/reports/mutation-follow-up.md` — checklist of **Survived** mutants only (where to add or strengthen assertions)

Stryker may exit with a non-zero code if there are survivors; that is expected until tests are strengthened. The make target always runs the follow-up step afterward, so the Survived checklist is still generated. Use the reports to decide what to fix.

## Step 2: Identify Weak Tests (if there are survivors)

From `apps/desktop`:

```bash
npm run mutation:weak-tests
```

This lists tests that **only cover Survived mutants** (they never kill any mutant). Those are the best candidates to improve: add or tighten assertions so the test would fail when the code is mutated.

## Step 3: Improve Tests (optional)

For each Survived mutant you want to fix:

1. **Location** — Use `reports/mutation-follow-up.md` (file, line, mutator, code snippet).
2. **Which tests to strengthen** — In `reports/mutation/mutation.html`, open the file and mutant; the report shows which tests **covered** it (ran but didn't fail). Add or tighten assertions in those tests.
3. Re-run mutation to confirm the survivor is killed.

## Summary

| Action | Command (from repo root unless noted) |
|--------|-------------------------------------|
| Run mutation (full) | `make desktop:mutation` |
| Run mutation (incremental) | `make desktop:mutation-incremental` |
| List tests that never kill | In `apps/desktop`: `npm run mutation:weak-tests` |
| Survived checklist | `apps/desktop/reports/mutation-follow-up.md` |
| Full report | `apps/desktop/reports/mutation/mutation.html` |

See [Desktop mutation workflow](docs/desktop-mutation-workflow.md) for the full workflow, scoped runs (mutate only specific files), and when to run full vs incremental.
