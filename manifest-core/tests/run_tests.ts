/**
 * Manifest Core v0.1 - Comprehensive Automated Test Suite
 * Verifies core language features, examples, edge cases, and beginner error messages.
 */

import { executeManifest, ManifestError } from '../src/index.ts';
import { runCompilerTests } from './run_compiler_tests.ts';
import { runAppTests } from './run_app_tests.ts';
import { runV03Tests } from './run_v03_tests.ts';
import { runV04Tests } from './run_v04_tests.ts';
import { runGitHubImportTests } from './run_github_import_tests.ts';
import { runMobileControlsTests } from './run_mobile_controls_tests.ts';
import { runStyledDashboardTests } from './run_styled_dashboard_tests.ts';
import { runOrchestratorTests } from './run_orchestrator_tests.ts';
import { runAuditVerificationTests } from './run_audit_verification_tests.ts';

interface TestCase {
  name: string;
  source: string;
  expectedOutput?: string[];
  expectedErrorSubstrings?: string[];
}

const tests: TestCase[] = [
  // 1. First Success Test (Hello World)
  {
    name: '1. First Success Test: APP "Hello" + WHEN app.starts',
    source: `
      APP "Hello"

      WHEN app.starts
      SHOW "Hello World"
      END
    `,
    expectedOutput: ['Hello World'],
  },

  // 2. Counter Test
  {
    name: '2. Counter State & Arithmetic',
    source: `
      APP "Counter"

      SET counter TO 0

      WHEN app.starts
      SET counter TO counter + 1
      SHOW counter
      END
    `,
    expectedOutput: ['1'],
  },

  // 3. Condition Test
  {
    name: '3. Condition (IF / ELSE)',
    source: `
      APP "Condition"

      SET balance TO 100

      WHEN app.starts

      IF balance >= 10
          SHOW "You can pay"
      ELSE
          SHOW "Insufficient balance"
      END

      END
    `,
    expectedOutput: ['You can pay'],
  },

  // 4. Condition False branch
  {
    name: '4. Condition False branch',
    source: `
      APP "ConditionFalse"

      SET balance TO 5

      WHEN app.starts
      IF balance >= 10
          SHOW "You can pay"
      ELSE
          SHOW "Insufficient balance"
      END
      END
    `,
    expectedOutput: ['Insufficient balance'],
  },

  // 5. Actions Test
  {
    name: '5. ACTION definition & CALL',
    source: `
      APP "Actions"

      ACTION greet user
      SHOW "Hello " + user
      END

      WHEN app.starts
      CALL greet "Manifest"
      END
    `,
    expectedOutput: ['Hello Manifest'],
  },

  // 6. Action with RETURN
  {
    name: '6. ACTION with RETURN value',
    source: `
      APP "ActionReturn"

      ACTION add a b
      RETURN a + b
      END

      WHEN app.starts
      SET result TO CALL add 5 10
      SHOW result
      END
    `,
    expectedOutput: ['15'],
  },

  // 7. Variables & Math
  {
    name: '7. Variables and Compound Math',
    source: `
      APP "MathTest"

      SET a TO 20
      SET b TO 4
      SET sum TO a + b
      SET diff TO a - b
      SET prod TO a * b
      SET quot TO a / b
      SET rem TO a % 3

      WHEN app.starts
      SHOW sum
      SHOW diff
      SHOW prod
      SHOW quot
      SHOW rem
      END
    `,
    expectedOutput: ['24', '16', '80', '5', '2'],
  },

  // 8. Alternative comparison operators («», «=», etc.)
  {
    name: '8. Alternative Comparison Operators («», «=»)',
    source: `
      APP "UnicodeOperators"

      WHEN app.starts
      IF 5 «» 10
          SHOW "not equal"
      END
      IF 5 «=» 5
          SHOW "less or equal"
      END
      END
    `,
    expectedOutput: ['not equal', 'less or equal'],
  },

  // 9. REPEAT loop
  {
    name: '9. REPEAT N TIMES loop',
    source: `
      APP "RepeatTest"

      WHEN app.starts
      REPEAT 3 TIMES
          SHOW "Tick"
      END
      END
    `,
    expectedOutput: ['Tick', 'Tick', 'Tick'],
  },

  // 10. FOR EACH loop
  {
    name: '10. FOR EACH loop over array',
    source: `
      APP "ForEachTest"

      SET names TO ["Alice", "Bob", "Charlie"]

      WHEN app.starts
      FOR EACH name IN names
          SHOW name
      END
      END
    `,
    expectedOutput: ['Alice', 'Bob', 'Charlie'],
  },

  // 11. USE module declaration
  {
    name: '11. USE Capability declaration',
    source: `
      APP "Capabilities"

      USE WEB
      USE DATABASE
      USE SOLANA

      WHEN app.starts
      SHOW "Capabilities verified"
      END
    `,
    expectedOutput: ['Capabilities verified'],
  },

  // 12. Comments support
  {
    name: '12. Comments support (-- , #, //, NOTE:)',
    source: `
      -- Top level comment
      APP "Comments"

      # Another comment format
      // Third comment format
      NOTE: This is also a human readable comment

      WHEN app.starts
      -- Inner comment
      SHOW "Comments work"
      END
    `,
    expectedOutput: ['Comments work'],
  },

  // 13. TRY / IF FAILED
  {
    name: '13. TRY / IF FAILED error handling',
    source: `
      APP "TryCatch"

      WHEN app.starts
      TRY
          SET x TO 100 / 0
          SHOW x
      IF FAILED
          SHOW "Safely caught error"
      END
      END
    `,
    expectedOutput: ['Safely caught error'],
  },

  // 14. Error Diagnostics: Missing value in SET
  {
    name: '14. Error Diagnostic: Missing value after SET TO',
    source: `
      APP "Error1"
      SET balance TO
    `,
    expectedErrorSubstrings: ['Manifest Error', 'expected a value after', 'Example:', 'SET balance TO 100'],
  },

  // 15. Error Diagnostics: Unclosed string
  {
    name: '15. Error Diagnostic: Unclosed string literal',
    source: `
      APP "Error2"
      SHOW "Hello
    `,
    expectedErrorSubstrings: ['Manifest Error', 'never closed before the line ended'],
  },

  // 16. Error Diagnostics: Unclosed IF block
  {
    name: '16. Error Diagnostic: Unclosed IF block',
    source: `
      APP "Error3"
      IF 10 > 5
      SHOW "True"
    `,
    expectedErrorSubstrings: ['Manifest Error', 'never closed with END'],
  },
];

export async function runAllTests(): Promise<{ passed: number; failed: number; total: number; results: any[] }> {
  let passed = 0;
  let failed = 0;
  const results: any[] = [];

  console.log('====================================================');
  console.log('   Running Manifest Core v0.1 Test Suite            ');
  console.log('====================================================\n');

  for (const t of tests) {
    try {
      const res = await executeManifest(t.source, { validate: true });
      if (t.expectedErrorSubstrings) {
        console.error(`[FAIL] ${t.name}`);
        console.error(`  Expected an error containing: ${t.expectedErrorSubstrings.join(', ')}, but execution succeeded.`);
        failed++;
        results.push({ name: t.name, status: 'FAILED', reason: 'Expected error but succeeded' });
      } else {
        const matches =
          JSON.stringify(res.output) === JSON.stringify(t.expectedOutput);
        if (matches) {
          console.log(`[PASS] ${t.name}`);
          passed++;
          results.push({ name: t.name, status: 'PASSED', output: res.output });
        } else {
          console.error(`[FAIL] ${t.name}`);
          console.error(`  Expected: ${JSON.stringify(t.expectedOutput)}`);
          console.error(`  Received: ${JSON.stringify(res.output)}`);
          failed++;
          results.push({
            name: t.name,
            status: 'FAILED',
            expected: t.expectedOutput,
            received: res.output,
          });
        }
      }
    } catch (err: unknown) {
      if (t.expectedErrorSubstrings) {
        const errText =
          err instanceof ManifestError
            ? err.toFormattedString()
            : String(err);
        const allPresent = t.expectedErrorSubstrings.every((sub) =>
          errText.includes(sub)
        );
        if (allPresent) {
          console.log(`[PASS] ${t.name} (Diagnostic error matched)`);
          passed++;
          results.push({ name: t.name, status: 'PASSED', errorOutput: errText });
        } else {
          console.error(`[FAIL] ${t.name}`);
          console.error(`  Error message did not match expected substrings:`);
          console.error(`  Received error: ${errText}`);
          failed++;
          results.push({ name: t.name, status: 'FAILED', errorReceived: errText });
        }
      } else {
        console.error(`[FAIL] ${t.name}`);
        console.error(`  Unexpected error:`, err);
        failed++;
        results.push({ name: t.name, status: 'FAILED', error: String(err) });
      }
    }
  }

  // Run Compiler and IR tests
  let compilerTestSummary = { passed: 0, failed: 0, total: 0 };
  try {
    const cRes = await runCompilerTests();
    compilerTestSummary = { passed: cRes.passed, failed: cRes.failed, total: cRes.passed + cRes.failed };
  } catch (err: any) {
    console.error('Compiler suite fatal error:', err);
    compilerTestSummary = { passed: 0, failed: 1, total: 1 };
  }
  const oldPassed = passed + compilerTestSummary.passed;
  const oldFailed = failed + compilerTestSummary.failed;
  const oldTotal = tests.length + compilerTestSummary.passed + compilerTestSummary.failed;

  // Run Manifest v0.2 Application Primitive Tests
  let appTestSummary = { passed: 0, failed: 0, total: 0, results: [] as any[] };
  try {
    appTestSummary = await runAppTests();
  } catch (err: any) {
    console.error('v0.2 application suite fatal error:', err);
    appTestSummary = { passed: 0, failed: 1, total: 1, results: [] };
  }
  const v02Passed = appTestSummary.passed;
  const v02Failed = appTestSummary.failed;
  const v02Total = appTestSummary.total;

  // Run Manifest v0.3 UI Primitives & Design System Tests
  let v03Summary = { passed: 0, failed: 0, total: 0 };
  try {
    v03Summary = runV03Tests();
  } catch (err: any) {
    console.error('v0.3 UI primitives suite fatal error:', err);
    v03Summary = { passed: 0, failed: 1, total: 1 };
  }
  const v03Passed = v03Summary.passed;
  const v03Failed = v03Summary.failed || 0;
  const v03Total = v03Summary.total;

  // Run Manifest v0.4 Solana, IDE & Architecture Tests
  let v04Summary = { passed: 0, failed: 0, total: 0 };
  try {
    v04Summary = await runV04Tests();
  } catch (err: any) {
    console.error('v0.4 Solana/IDE suite fatal error:', err);
    v04Summary = { passed: 0, failed: 1, total: 1 };
  }
  const v04Passed = v04Summary.passed;
  const v04Failed = v04Summary.failed;
  const v04Total = v04Summary.total;

  // Run GitHub Import Provider Tests
  let ghSummary = { passed: 0, failed: 0, total: 0 };
  try {
    ghSummary = await runGitHubImportTests();
  } catch (err: any) {
    console.error('GitHub import suite fatal error:', err);
    ghSummary = { passed: 0, failed: 1, total: 1 };
  }
  const ghPassed = ghSummary.passed;
  const ghFailed = ghSummary.failed;
  const ghTotal = ghSummary.total;

  // Run Mobile IDE Controls Tests (Requirement 12)
  let mobileSummary = { passed: 0, failed: 0, total: 0 };
  try {
    mobileSummary = await runMobileControlsTests();
  } catch (err: any) {
    console.error('Mobile controls suite fatal error:', err);
    mobileSummary = { passed: 0, failed: 1, total: 1 };
  }
  const mobilePassed = mobileSummary.passed;
  const mobileFailed = mobileSummary.failed;
  const mobileTotal = mobileSummary.total;

  // Run Styled Dashboard Verification Tests (Phase 5)
  let styledSummary = { passed: 0, failed: 0, total: 0 };
  try {
    styledSummary = await runStyledDashboardTests();
  } catch (err: any) {
    console.error('Styled dashboard suite fatal error:', err);
    styledSummary = { passed: 0, failed: 1, total: 1 };
  }
  const styledPassed = styledSummary.passed;
  const styledFailed = styledSummary.failed;
  const styledTotal = styledSummary.total;

  // Run Unified Execution Orchestrator & Static Web Provider Tests
  let orchSummary = { passed: 0, failed: 0, total: 0 };
  try {
    orchSummary = await runOrchestratorTests();
  } catch (err: any) {
    console.error('Orchestrator suite fatal error:', err);
    orchSummary = { passed: 0, failed: 1, total: 1 };
  }
  const orchPassed = orchSummary.passed;
  const orchFailed = orchSummary.failed;
  const orchTotal = orchSummary.total;

  // Run Integrated Engineering Audit & Parity Verification Tests
  let auditSummary = { passed: 0, failed: 0, total: 0 };
  try {
    auditSummary = await runAuditVerificationTests();
  } catch (err: any) {
    console.error('Audit verification suite fatal error:', err);
    auditSummary = { passed: 0, failed: 1, total: 1 };
  }
  const auditPassed = auditSummary.passed;
  const auditFailed = auditSummary.failed;
  const auditTotal = auditSummary.total;

  const totalPassed = oldPassed + v02Passed + v03Passed + v04Passed + ghPassed + mobilePassed + styledPassed + orchPassed + auditPassed;
  const totalFailed = oldFailed + v02Failed + v03Failed + v04Failed + ghFailed + mobileFailed + styledFailed + orchFailed + auditFailed;
  const grandTotal = oldTotal + v02Total + v03Total + v04Total + ghTotal + mobileTotal + styledTotal + orchTotal + auditTotal;

  console.log('\n====================================================');
  console.log('MANIFEST APPLICATION LANGUAGE TEST REPORT');
  console.log('====================================================');
  console.log(`v0.1 core tests:\n${oldPassed}/${oldTotal} (passed: ${oldPassed}, failed: ${oldFailed})\n`);
  console.log(`v0.2 application tests:\n${v02Passed}/${v02Total} (passed: ${v02Passed}, failed: ${v02Failed})\n`);
  console.log(`v0.3 UI primitives & style tests:\n${v03Passed}/${v03Total} (passed: ${v03Passed}, failed: ${v03Failed})\n`);
  console.log(`v0.4 Solana, IDE & architecture tests:\n${v04Passed}/${v04Total} (passed: ${v04Passed}, failed: ${v04Failed})\n`);
  console.log(`GitHub import tests:\n${ghPassed}/${ghTotal} (passed: ${ghPassed}, failed: ${ghFailed})\n`);
  console.log(`Mobile IDE controls tests:\n${mobilePassed}/${mobileTotal} (passed: ${mobilePassed}, failed: ${mobileFailed})\n`);
  console.log(`Styled Dashboard verification tests:\n${styledPassed}/${styledTotal} (passed: ${styledPassed}, failed: ${styledFailed})\n`);
  console.log(`Execution Orchestrator tests:\n${orchPassed}/${orchTotal} (passed: ${orchPassed}, failed: ${orchFailed})\n`);
  console.log(`Integrated Audit & Parity tests:\n${auditPassed}/${auditTotal} (passed: ${auditPassed}, failed: ${auditFailed})\n`);
  console.log(`Grand Total:\n${totalPassed}/${grandTotal} (passed: ${totalPassed}, failed: ${totalFailed})`);
  console.log('====================================================\n');

  return { passed: totalPassed, failed: totalFailed, total: grandTotal, results: [...results, ...appTestSummary.results] };
}

// When run directly from CLI (Node.js / tsx environment only)
const isNodeCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_tests.ts'));

if (isNodeCLI) {
  runAllTests()
    .then((summary) => {
      if (summary.failed > 0 && typeof process.exit === 'function') {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal test error:', err);
      if (typeof process.exit === 'function') {
        process.exit(1);
      }
    });
}
