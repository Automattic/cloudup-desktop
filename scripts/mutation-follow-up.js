/**
 * Reads Stryker's mutation.json and writes a markdown checklist of Survived
 * mutants only (covered code where tests don't catch the mutation → strengthen
 * assertions). NoCoverage is omitted; use the coverage report for uncovered code.
 *
 * Workflow: improve coverage first (coverage report), then run mutation testing
 * and this script. Run after: npm run test:mutation
 *
 * Output: reports/mutation-follow-up.md
 */

const fs = require('fs');
const path = require('path');

const REPORT_JSON = path.join(__dirname, '..', 'reports', 'mutation', 'mutation.json');
const OUTPUT_MD = path.join(__dirname, '..', 'reports', 'mutation-follow-up.md');

function getLine(source, lineNum) {
  if (!source || lineNum < 1) return '';
  const lines = source.split('\n');
  return (lines[lineNum - 1] || '').trim();
}

function main() {
  if (!fs.existsSync(REPORT_JSON)) {
    console.error('No mutation report found. Run first: npm run test:mutation');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
  const files = report.files || {};
  const survived = []; // Survived only; NoCoverage → use coverage report
  let noCoverageCount = 0;

  for (const [filePath, fileResult] of Object.entries(files)) {
    const source = fileResult.source || '';
    const mutants = fileResult.mutants || [];
    for (const m of mutants) {
      if (m.status === 'NoCoverage') {
        noCoverageCount++;
        continue;
      }
      if (m.status !== 'Survived') continue;
      const line = m.location?.start?.line ?? 0;
      survived.push({
        file: filePath,
        line,
        mutatorName: m.mutatorName || '?',
        replacement: m.replacement != null ? String(m.replacement) : '',
        codeLine: getLine(source, line),
      });
    }
  }

  survived.sort((a, b) => {
    const c = a.file.localeCompare(b.file);
    return c !== 0 ? c : a.line - b.line;
  });

  const lines = [
    '# Mutation follow-up: strengthen assertions (Survived only)',
    '',
    '**When to use this:** After you have improved coverage using the coverage report. This list contains only **Survived** mutants: code that tests run but do not assert on. Add or strengthen assertions so each mutation is killed.',
    '',
    'NoCoverage mutants are omitted; use the coverage report (`coverage/lcov-report/` or `npm test -- --coverage --coverageProvider=v8`) to find uncovered code and add tests first.',
    '',
    `Generated from \`reports/mutation/mutation.json\` (run \`make desktop:mutation\` from repo root to refresh). ${noCoverageCount} NoCoverage mutants omitted.`,
    '',
    '| File | Line | Mutator | Replacement |',
    '|------|------|---------|-------------|',
  ];

  for (const a of survived) {
    const replacement = (a.replacement || '')
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
      .slice(0, 60);
    lines.push(`| \`${a.file}\` | ${a.line} | ${a.mutatorName} | \`${replacement}\` |`);
  }

  lines.push('');
  lines.push('## By file (with code snippet)');
  lines.push('');

  let currentFile = '';
  for (const a of survived) {
    if (a.file !== currentFile) {
      currentFile = a.file;
      lines.push(`### ${currentFile}`);
      lines.push('');
    }
    lines.push(`- [ ] **Line ${a.line}** — Add or strengthen assertion so this mutation is killed`);
    const safeReplacement = (a.replacement || '')
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\r?\n/g, ' ')
      .slice(0, 60);
    lines.push(`  - Mutator: \`${a.mutatorName}\` → \`${safeReplacement}\``);
    if (a.codeLine) {
      const safe = a.codeLine.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
      lines.push(`  - Code: \`${safe}\``);
    }
    lines.push('');
  }

  const outDir = path.dirname(OUTPUT_MD);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_MD)} (${survived.length} Survived, ${noCoverageCount} NoCoverage omitted)`);
}

main();
