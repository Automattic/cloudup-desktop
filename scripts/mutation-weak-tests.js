/**
 * Reads Stryker's mutation.json and lists tests that only cover Survived mutants
 * (never kill any). Those tests run code but don't assert on behavior that would
 * catch mutations — candidates for strengthening.
 *
 * Run after: npm run test:mutation (or make desktop:mutation)
 */

const fs = require('fs');
const path = require('path');

const REPORT_JSON = path.join(__dirname, '..', 'reports', 'mutation', 'mutation.json');

function testIdToName(report, id) {
  const testFiles = report.testFiles || {};
  for (const [, def] of Object.entries(testFiles)) {
    const tests = def.tests || [];
    const found = tests.find((t) => t.id === id);
    if (found) return found.name || id;
  }
  return id;
}

function main() {
  if (!fs.existsSync(REPORT_JSON)) {
    console.error('No mutation report found. Run first: npm run test:mutation');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
  const testStats = {};

  for (const [, data] of Object.entries(report.files || {})) {
    for (const m of data.mutants || []) {
      if (m.status === 'Killed' && m.killedBy) {
        for (const id of m.killedBy) {
          const name = testIdToName(report, id);
          testStats[name] = testStats[name] || { kill: 0, coverOnly: 0 };
          testStats[name].kill++;
        }
      }
      if (m.status === 'Survived' && m.coveredBy) {
        for (const id of m.coveredBy) {
          const name = testIdToName(report, id);
          testStats[name] = testStats[name] || { kill: 0, coverOnly: 0 };
          testStats[name].coverOnly++;
        }
      }
    }
  }

  const weak = Object.entries(testStats)
    .filter(([, s]) => s.kill === 0 && s.coverOnly > 0)
    .sort((a, b) => b[1].coverOnly - a[1].coverOnly);

  if (weak.length === 0) {
    console.log('No weak tests (every test that covers code has killed at least one mutant).');
    return;
  }

  console.log('Tests that only cover Survived mutants (never kill) — strengthen assertions:\n');
  weak.forEach(([name, s]) => {
    console.log(`  ${s.coverOnly.toString().padStart(3)}×  ${name}`);
  });
  console.log(`\n(${weak.length} tests; run mutation:follow-up for Survived checklist)`);
}

main();
