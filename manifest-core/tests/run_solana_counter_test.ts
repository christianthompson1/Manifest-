/**
 * Manifest Studio - Solana Counter Test & Simulation Suite
 *
 * Explicitly separates:
 * - Scenario A: Real in-process LiteSVM SystemProgram SOL transfer execution
 * - Scenario B: Anchor checked_add / checked_sub codegen + simulated JS counter state transitions
 * - Scenario C: Simulated JS counter underflow boundary check (NOT on-chain SBF program execution)
 */

import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import {
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  appendTransactionMessageInstruction,
  lamports,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { SolanaProgramIR } from '../src/solana/solana-ir.ts';
import { AnchorGenerator } from '../src/solana/anchor-generator.ts';
import {
  VerificationEntry,
  VerificationAggregateCounts,
  computeAggregateCounts,
} from '../src/verification/result-model.ts';

export interface CounterStepResult {
  scenario: 'A-LiteSVM-SystemProgram' | 'B-JS-Counter-Simulation' | 'C-JS-Underflow-Simulation';
  step: string;
  counter: number | string;
  status: 'ok' | 'expected_error';
  execution: 'executed' | 'simulated';
  backend: 'litesvm' | 'js-counter-model';
  cu: number;
}

export interface SolanaCounterTestReport {
  passed: boolean;
  steps: CounterStepResult[];
  scenarios: VerificationEntry[];
  counts: VerificationAggregateCounts;
  note: string;
}

export async function runSolanaCounterTest(): Promise<SolanaCounterTestReport> {
  console.log('\n--- Running Solana Counter Verification & Simulation Suite ---');

  // 1. Define the Counter Program IR with checked arithmetic
  const counterProgramIR: SolanaProgramIR = {
    programName: 'CounterProgram',
    programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
    accounts: [
      {
        name: 'CounterState',
        fields: [
          { name: 'count', fieldType: 'u64' },
          { name: 'authority', fieldType: 'pubkey' },
        ],
      },
    ],
    instructions: [
      {
        name: 'initialize',
        accounts: [
          { name: 'state', isMut: true, isSigner: false, accountType: 'CounterState' },
          { name: 'authority', isMut: true, isSigner: true },
        ],
        requires: ['signer = authority'],
        mutations: [{ target: 'state.count', expression: '0' }],
        cpis: [],
      },
      {
        name: 'increment',
        accounts: [
          { name: 'state', isMut: true, isSigner: false, accountType: 'CounterState' },
          { name: 'authority', isMut: true, isSigner: true },
        ],
        requires: ['signer = authority'],
        mutations: [{ target: 'state.count', expression: 'state.count + 1' }],
        cpis: [],
      },
      {
        name: 'decrement',
        accounts: [
          { name: 'state', isMut: true, isSigner: false, accountType: 'CounterState' },
          { name: 'authority', isMut: true, isSigner: true },
        ],
        requires: ['signer = authority'],
        mutations: [{ target: 'state.count', expression: 'state.count - 1' }],
        cpis: [],
      },
    ],
    errors: [
      { code: 6002, name: 'NumericalOverflow', msg: 'Numerical overflow during checked arithmetic' },
      { code: 6003, name: 'NumericalUnderflow', msg: 'Numerical underflow during checked arithmetic' },
    ],
  };

  // Emit Anchor Rust source & verify checked math constructs exist
  const anchorCompilation = AnchorGenerator.generate(counterProgramIR);
  if (!anchorCompilation.rustCode.includes('checked_add')) {
    throw new Error('Anchor generator failed to emit checked_add for increment mutation');
  }
  if (!anchorCompilation.rustCode.includes('checked_sub')) {
    throw new Error('Anchor generator failed to emit checked_sub for decrement mutation');
  }

  const steps: CounterStepResult[] = [];
  const scenarios: VerificationEntry[] = [];

  // -------------------------------------------------------------------------
  // SCENARIO A: Real LiteSVM SystemProgram Transfer Execution
  // -------------------------------------------------------------------------
  const svm = new LiteSVM();
  const authority = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  svm.airdrop(authority.address, lamports(10_000_000_000n));

  const transferIx = getTransferSolInstruction({
    source: authority,
    destination: recipient.address,
    amount: lamports(100_000_000n),
  });
  const tx0 = await pipe(
    createTransactionMessage({ version: 0 }),
    (t) => setTransactionMessageFeePayerSigner(authority, t),
    (t) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(t),
    (t) => appendTransactionMessageInstruction(transferIx, t),
    (t) => signTransactionMessageWithSigners(t),
  );
  const transferRes = svm.sendTransaction(tx0);
  if (transferRes instanceof FailedTransactionMetadata) {
    throw new Error(`Real LiteSVM SystemProgram transfer failed: ${transferRes.err()}`);
  }
  const transferCu = Number(transferRes.computeUnitsConsumed());
  const recipientBalance = svm.getBalance(recipient.address) ?? 0n;
  if (recipientBalance !== 100_000_000n) {
    throw new Error(`Expected recipient balance 100000000 lamports, got ${recipientBalance}`);
  }
  console.log(`  ✓ [Scenario A - Real LiteSVM] SystemProgram transfer executed (CU: ${transferCu})`);
  steps.push({
    scenario: 'A-LiteSVM-SystemProgram',
    step: 'A1. LiteSVM SystemProgram SOL transfer (0.1 SOL)',
    counter: 'n/a (SOL transfer)',
    status: 'ok',
    execution: 'executed',
    backend: 'litesvm',
    cu: transferCu,
  });
  scenarios.push({
    id: 'scenario-a-litesvm-transfer',
    name: 'Scenario A: Real LiteSVM SystemProgram SOL transfer',
    status: 'passed',
    compilation: 'not-attempted',
    execution: 'executed',
    backend: 'litesvm',
    output: `recipient_lamports=${recipientBalance}, cu=${transferCu}`,
  });

  // -------------------------------------------------------------------------
  // SCENARIO B: Anchor Checked-Math Codegen + Simulated JS Counter State Model
  // -------------------------------------------------------------------------
  // NOTE: Custom program binary (.so) is not compiled in this environment;
  // counter arithmetic is verified by Rust codegen inspection + JS state model.
  let currentCounter = 0;
  const applyJsIncrement = () => {
    currentCounter += 1;
  };
  const applyJsDecrement = () => {
    if (currentCounter === 0) {
      throw new Error('Custom program error: 0x1773 (NumericalUnderflow: JS model checked_sub underflow)');
    }
    currentCounter -= 1;
  };

  steps.push({
    scenario: 'B-JS-Counter-Simulation',
    step: 'B1. Initial counter state (JS model)',
    counter: currentCounter,
    status: 'ok',
    execution: 'simulated',
    backend: 'js-counter-model',
    cu: 0,
  });
  console.log(`  ✓ [Scenario B - JS Simulation] Initial: counter = ${currentCounter}`);

  applyJsIncrement();
  steps.push({
    scenario: 'B-JS-Counter-Simulation',
    step: 'B2. increment (JS model)',
    counter: currentCounter,
    status: 'ok',
    execution: 'simulated',
    backend: 'js-counter-model',
    cu: 0,
  });
  console.log(`  ✓ [Scenario B - JS Simulation] increment: counter = ${currentCounter}`);

  applyJsIncrement();
  steps.push({
    scenario: 'B-JS-Counter-Simulation',
    step: 'B3. increment (JS model)',
    counter: currentCounter,
    status: 'ok',
    execution: 'simulated',
    backend: 'js-counter-model',
    cu: 0,
  });
  console.log(`  ✓ [Scenario B - JS Simulation] increment: counter = ${currentCounter}`);

  applyJsDecrement();
  steps.push({
    scenario: 'B-JS-Counter-Simulation',
    step: 'B4. decrement (JS model)',
    counter: currentCounter,
    status: 'ok',
    execution: 'simulated',
    backend: 'js-counter-model',
    cu: 0,
  });
  console.log(`  ✓ [Scenario B - JS Simulation] decrement: counter = ${currentCounter}`);

  applyJsDecrement();
  steps.push({
    scenario: 'B-JS-Counter-Simulation',
    step: 'B5. decrement (JS model)',
    counter: currentCounter,
    status: 'ok',
    execution: 'simulated',
    backend: 'js-counter-model',
    cu: 0,
  });
  console.log(`  ✓ [Scenario B - JS Simulation] decrement: counter = ${currentCounter}`);

  scenarios.push({
    id: 'scenario-b-js-counter-sim',
    name: 'Scenario B: Anchor checked_add/checked_sub codegen + JS counter state simulation',
    status: 'passed',
    compilation: 'generated-source-only',
    execution: 'simulated',
    backend: 'js-counter-model',
    reason: 'Simulates state transitions in JS alongside Rust source check; no compiled SBF .so binary invoked',
    output: '0 -> 1 -> 2 -> 1 -> 0',
  });

  // -------------------------------------------------------------------------
  // SCENARIO C: JS Counter Model Underflow Boundary Check (Simulated Only)
  // -------------------------------------------------------------------------
  let underflowCaught = false;
  try {
    applyJsDecrement();
  } catch (err: any) {
    if (String(err?.message || err).includes('NumericalUnderflow')) {
      underflowCaught = true;
      steps.push({
        scenario: 'C-JS-Underflow-Simulation',
        step: 'C1. decrement at 0 underflow guard (JS model — NOT on-chain SBF)',
        counter: 'ERROR (Simulated JS Model: NumericalUnderflow)',
        status: 'expected_error',
        execution: 'simulated',
        backend: 'js-counter-model',
        cu: 0,
      });
      console.log(
        '  ✓ [Scenario C - JS Simulation] Decrement at 0 threw NumericalUnderflow in JS model (on-chain SBF binary not compiled/executed)'
      );
    }
  }

  if (!underflowCaught) {
    throw new Error('Failed to catch expected underflow error in JS counter simulation');
  }

  scenarios.push({
    id: 'scenario-c-js-underflow-sim',
    name: 'Scenario C: JS counter underflow boundary check (simulated only)',
    status: 'passed',
    compilation: 'generated-source-only',
    execution: 'simulated',
    backend: 'js-counter-model',
    reason: 'Simulated JS boundary check; compiled SBF ELF (.so) required for real on-chain underflow execution',
    output: 'NumericalUnderflow caught in JS model',
  });

  scenarios.push({
    id: 'scenario-d-custom-sbf-program',
    name: 'Scenario D: Compiled SBF CounterProgram ELF execution in LiteSVM',
    status: 'skipped',
    compilation: 'generated-source-only',
    execution: 'not-run',
    backend: 'litesvm',
    reason: 'anchor/cargo-build-sbf unavailable in container; CounterProgram .so was not compiled or loaded into LiteSVM',
  });

  const counts = computeAggregateCounts(scenarios);
  const allExecutedOrSimulatedPassed = counts.failed === 0 && counts.passed > 0;

  return {
    passed: allExecutedOrSimulatedPassed,
    steps,
    scenarios,
    counts,
    note: 'Scenario A executed real LiteSVM SystemProgram transfer; Scenarios B & C ran in simulated js-counter-model; custom SBF ELF (.so) execution is skipped.',
  };
}

if (process.argv[1]?.endsWith('run_solana_counter_test.ts')) {
  runSolanaCounterTest().then((res) => {
    console.log(
      `\nSolana Counter Suite completed: ${res.counts.passed} passed (1 real LiteSVM, 2 JS-simulated), ${res.counts.skipped} skipped (custom SBF .so), ${res.counts.failed} failed`
    );
    process.exit(res.passed ? 0 : 1);
  });
}
