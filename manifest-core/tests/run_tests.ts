/**
 * Manifest Core v0.1 - Comprehensive Automated Test Suite
 * Verifies core language features, examples, edge cases, and beginner error messages.
 */

import { executeManifest, ManifestError } from '../src/index.ts';
import { runCompilerTests } from './run_compiler_tests.ts';
import { runAppTests } from './run_app_tests.ts';
import { runV03Tests } from './run_v03_tests.ts';
import { runV04Tests } from './run_v04_tests.ts';

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
  const compilerTestSummary = await runCompilerTests();
  const oldPassed = passed + compilerTestSummary.passed;
  const oldFailed = failed + compilerTestSummary.failed;
  const oldTotal = tests.length + compilerTestSummary.passed + compilerTestSummary.failed;

  // Run Manifest v0.2 Application Primitive Tests
  const appTestSummary = await runAppTests();
  const v02Passed = appTestSummary.passed;
  const v02Failed = appTestSummary.failed;
  const v02Total = appTestSummary.total;

  // Run Manifest v0.3 UI Primitives & Design System Tests
  const v03Summary = runV03Tests();
  const v03Passed = v03Summary.passed;
  const v03Total = v03Summary.total;

  // Run Manifest v0.4 Solana, IDE & Architecture Tests
  const v04Summary = await runV04Tests();
  const v04Passed = v04Summary.passed;
  const v04Total = v04Summary.total;

  const totalPassed = oldPassed + v02Passed + v03Passed + v04Passed;
  const totalFailed = oldFailed + v02Failed + v04Summary.failed;
  const grandTotal = oldTotal + v02Total + v03Total + v04Total;

  console.log('\n====================================================');
  console.log('MANIFEST APPLICATION LANGUAGE TEST REPORT');
  console.log('====================================================');
  console.log(`v0.1 core tests:\n${oldPassed}/${oldTotal}\n`);
  console.log(`v0.2 application tests:\n${v02Passed}/${v02Total}\n`);
  console.log(`v0.3 UI primitives & style tests:\n${v03Passed}/${v03Total}\n`);
  console.log(`v0.4 Solana, IDE & architecture tests:\n${v04Passed}/${v04Total}\n`);
  console.log(`Grand Total:\n${totalPassed}/${grandTotal}`);
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
