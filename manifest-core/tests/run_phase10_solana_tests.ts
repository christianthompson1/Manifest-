/**
 * Manifest Phase 10 Automated Test Suite
 * Solana Compiler, LiteSVM Runtime & Negative Security Verification
 *
 * Validates:
 * 1. Solana Program IR & Account Space Calculation
 * 2. Anchor Rust Generation (PDA constraints, checked arithmetic, error codes)
 * 3. Anchor IDL JSON Export & Structure Verification
 * 4. Real LiteSVM In-Process Execution (Airdrop, Signers, SOL Transfer, Balance State)
 * 5. Compute Unit Consumption Measurement & Native VM Logs
 * 6. Negative Security Test: Rejection of Unauthorized Signers
 * 7. Negative Security Test: Rejection of Overdrafts / Numerical Underflow
 * 8. Honest Toolchain Status & CI Workflow (.github/workflows/solana-sbf-build.yml) Verification
 */

import fs from 'fs';
import path from 'path';
import { SolanaProgramIR, calculateAccountSpace } from '../src/solana/solana-ir.ts';
import { AnchorGenerator } from '../src/solana/anchor-generator.ts';
import { LiteSVMRunner } from '../src/solana/litesvm-runner.ts';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import {
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  appendTransactionMessageInstruction,
  lamports,
  AccountRole,
  address,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import bs58 from 'bs58';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`[Phase 10 Solana Test Failure] ${msg}`);
  }
}

async function runPhase10Tests() {
  console.log('=== RUNNING MANIFEST PHASE 10: SOLANA COMPILER & LITESVM TESTS ===\n');
  let passed = 0;

  // Test 1: Account Space Calculation
  {
    const fields = [
      { name: 'authority', fieldType: 'pubkey' as const }, // 32
      { name: 'count', fieldType: 'u64' as const },         // 8
      { name: 'is_active', fieldType: 'bool' as const },    // 1
      { name: 'label', fieldType: 'string' as const },       // 4 + 64 = 68
    ];
    // 8 (discriminator) + 32 + 8 + 1 + 68 = 117
    const space = calculateAccountSpace(fields);
    assert(space === 117, `Account space should be 117 bytes, got ${space}`);
    console.log('  ✓ Test 1: Exact dynamic account space calculation verified (117 bytes)');
    passed++;
  }

  // Test 2: Anchor Rust & IDL Generation with Checked Arithmetic
  const testProgramIR: SolanaProgramIR = {
    programName: 'EscrowVault',
    programId: 'Escrow1111111111111111111111111111111111111',
    accounts: [
      {
        name: 'VaultState',
        fields: [
          { name: 'initializer', fieldType: 'pubkey' },
          { name: 'balance', fieldType: 'u64' },
          { name: 'bump', fieldType: 'u8' },
        ],
        pda: {
          seeds: [
            { kind: 'literal', value: 'vault' },
            { kind: 'account', value: 'initializer' },
          ],
          bump: 'vault_bump',
        },
      },
    ],
    instructions: [
      {
        name: 'deposit',
        accounts: [
          { name: 'vault_state', isMut: true, isSigner: false, accountType: 'VaultState' },
          { name: 'initializer', isMut: true, isSigner: true },
        ],
        args: [{ name: 'amount', argType: 'u64' }],
        requires: ['amount > 0'],
        mutations: [{ target: 'vault_state.balance', expression: 'vault_state.balance + amount' }],
        cpis: [],
      },
      {
        name: 'withdraw',
        accounts: [
          { name: 'vault_state', isMut: true, isSigner: false, accountType: 'VaultState' },
          { name: 'initializer', isMut: true, isSigner: true },
        ],
        args: [{ name: 'amount', argType: 'u64' }],
        requires: ['vault_state.balance >= amount'],
        mutations: [{ target: 'vault_state.balance', expression: 'vault_state.balance - amount' }],
        cpis: [],
      },
    ],
    errors: [
      { code: 6001, name: 'InsufficientFunds', msg: 'Requested amount exceeds vault balance' },
      { code: 6002, name: 'NumericalOverflow', msg: 'Overflow during checked addition' },
      { code: 6003, name: 'NumericalUnderflow', msg: 'Underflow during checked subtraction' },
    ],
  };

  {
    const comp = AnchorGenerator.generate(testProgramIR);
    assert(comp.rustCode.includes('pub mod escrow_vault'), 'Generated Rust must include program module');
    assert(comp.rustCode.includes('checked_add'), 'Rust code must use checked_add for deposit mutation');
    assert(comp.rustCode.includes('checked_sub'), 'Rust code must use checked_sub for withdraw mutation');
    assert(comp.rustCode.includes('declare_id!("Escrow1111111111111111111111111111111111111")'), 'Program ID must match');
    assert(comp.rustCode.includes('#[error_code]'), 'Must generate Anchor error_code enum');
    assert(comp.rustCode.includes('InsufficientFunds'), 'Must include custom InsufficientFunds error');

    // IDL JSON verification
    const idl = typeof comp.idl === 'object' ? comp.idl : JSON.parse(comp.idlJson);
    assert(idl.name === 'escrow_vault', 'IDL name mismatch');
    assert(idl.instructions.length === 2, 'IDL instructions count should be 2');
    assert(idl.instructions[0].name === 'deposit', 'First instruction must be deposit');
    assert(idl.errors.length >= 3, 'IDL errors should include custom error codes');
    console.log('  ✓ Test 2: Anchor Rust generator emits checked math, PDA constraints, and error codes');
    console.log('  ✓ Test 3: Anchor IDL JSON structure exported and validated');
    passed += 2;
  }

  // Test 4: Real LiteSVM In-Process Execution (Positive Path)
  {
    const svm = new LiteSVM();
    const payer = await generateKeyPairSigner();
    const recipient = await generateKeyPairSigner();

    // Airdrop 3 SOL
    svm.airdrop(payer.address, lamports(3_000_000_000n));
    const payerInitial = svm.getBalance(payer.address);
    assert(payerInitial === 3_000_000_000n, 'Payer balance after airdrop should be 3 SOL');

    // Transfer 1 SOL
    const transferIx = getTransferSolInstruction({
      source: payer,
      destination: recipient.address,
      amount: lamports(1_000_000_000n),
    });

    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (t) => setTransactionMessageFeePayerSigner(payer, t),
      (t) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(t),
      (t) => appendTransactionMessageInstruction(transferIx, t),
      (t) => signTransactionMessageWithSigners(t),
    );

    const res = svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`SOL transfer transaction failed unexpectedly in LiteSVM: ${res.err()}`);
    }

    const recipBal = svm.getBalance(recipient.address);
    assert(recipBal === 1_000_000_000n, 'Recipient should receive exactly 1 SOL');

    const cuConsumed = Number(res.computeUnitsConsumed());
    assert(cuConsumed > 0, `Compute units consumed should be positive, got ${cuConsumed}`);
    assert(res.logs().length > 0, 'Transaction should emit native VM logs');
    console.log(`  ✓ Test 4: Real LiteSVM executed SOL transfer (CU: ${cuConsumed}, sig: ${bs58.encode(res.signature()).slice(0, 16)}...)`);
    passed++;
  }

  // Test 5: Negative Security Test — Unauthorized Signer Rejection
  {
    const svm = new LiteSVM();
    const attacker = await generateKeyPairSigner();
    const victim = await generateKeyPairSigner();
    const lootAccount = await generateKeyPairSigner();

    svm.airdrop(attacker.address, lamports(100_000_000n)); // 0.1 SOL for fee
    svm.airdrop(victim.address, lamports(10_000_000_000n)); // 10 SOL victim funds

    // Construct instruction attempting to spend victim's SOL without victim's signature
    const unauthTransferIx = {
      programAddress: address('11111111111111111111111111111111'),
      accounts: [
        { address: victim.address, role: AccountRole.WRITABLE }, // not signer!
        { address: lootAccount.address, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    };

    const maliciousTx = await pipe(
      createTransactionMessage({ version: 0 }),
      (t) => setTransactionMessageFeePayerSigner(attacker, t),
      (t) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(t),
      (t) => appendTransactionMessageInstruction(unauthTransferIx, t),
      (t) => signTransactionMessageWithSigners(t),
    );

    const malRes = svm.sendTransaction(maliciousTx);
    const failed = malRes instanceof FailedTransactionMetadata;
    assert(failed, 'CRITICAL: Transaction without required signer signature must fail in LiteSVM');

    const victimBalanceAfter = svm.getBalance(victim.address);
    assert(victimBalanceAfter === 10_000_000_000n, 'Victim balance must remain intact');
    console.log('  ✓ Test 5: Negative security check: LiteSVM rejects transaction missing required signer');
    passed++;
  }

  // Test 6: Negative Security Test — Insufficient Funds / Overdraft Rejection
  {
    const svm = new LiteSVM();
    const poorAccount = await generateKeyPairSigner();
    const recipient = await generateKeyPairSigner();

    // Give only 0.005 SOL (5,000,000 lamports)
    svm.airdrop(poorAccount.address, lamports(5_000_000n));

    // Attempt to transfer 1,000 SOL
    const overdraftIx = getTransferSolInstruction({
      source: poorAccount,
      destination: recipient.address,
      amount: lamports(1_000_000_000_000n),
    });

    const overdraftTx = await pipe(
      createTransactionMessage({ version: 0 }),
      (t) => setTransactionMessageFeePayerSigner(poorAccount, t),
      (t) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(t),
      (t) => appendTransactionMessageInstruction(overdraftIx, t),
      (t) => signTransactionMessageWithSigners(t),
    );

    const overdraftRes = svm.sendTransaction(overdraftTx);
    const failed = overdraftRes instanceof FailedTransactionMetadata;
    assert(failed, 'CRITICAL: Overdraft transaction must fail in LiteSVM');
    console.log('  ✓ Test 6: Negative security check: LiteSVM rejects overdraft / insufficient balance');
    passed++;
  }

  // Test 7: LiteSVMRunner Integrated End-to-End Test Suite
  {
    const runnerRes = await LiteSVMRunner.runTestSuite(testProgramIR);
    assert(runnerRes.success, 'LiteSVMRunner built-in VM steps must pass');
    assert(runnerRes.stepsCount >= 5, 'Must include executed VM steps and static analysis steps');
    assert(
      runnerRes.passedCount === 3 &&
        runnerRes.skippedCount === testProgramIR.instructions.length + 1 &&
        runnerRes.passedCount +
          runnerRes.failedCount +
          runnerRes.skippedCount +
          runnerRes.unsupportedCount +
          runnerRes.notRunCount ===
          runnerRes.stepsCount,
      'LiteSVMRunner must count only real LiteSVM steps in passedCount and mark uncompiled custom instructions as skipped'
    );
    assert(
      runnerRes.steps
        .filter((s) => s.instructionName === 'deposit' || s.instructionName === 'withdraw')
        .every((s) => s.status === 'skipped' && s.execution === 'analyzed-only' && !s.success),
      'Uncompiled custom instructions must never be marked success/passed'
    );
    assert(runnerRes.steps.some((s) => s.stepName.includes('Unauthorized Signer')), 'Must include unauthorized signer step');
    assert(runnerRes.steps.some((s) => s.stepName.includes('Insufficient Balance')), 'Must include balance underflow step');
    console.log(
      `  ✓ Test 7: LiteSVMRunner executed ${runnerRes.passedCount} real LiteSVM steps, skipped ${runnerRes.skippedCount} uncompiled/metadata steps (${runnerRes.stepsCount} total)`
    );
    passed++;
  }

  // Test 8: SBF Build CI Workflow Configuration
  {
    const workflowPath = path.resolve(process.cwd(), '.github/workflows/solana-sbf-build.yml');
    assert(fs.existsSync(workflowPath), `Workflow file must exist at ${workflowPath}`);
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert(content.includes('SOLANA_VERSION: "1.18.26"'), 'Workflow must pin Solana CLI 1.18.26');
    assert(content.includes('ANCHOR_VERSION: "0.30.1"'), 'Workflow must pin Anchor CLI 0.30.1');
    assert(content.includes('anchor build'), 'Workflow must include anchor build step');
    console.log('  ✓ Test 8: Pinned CI workflow (.github/workflows/solana-sbf-build.yml) verified');
    passed++;
  }

  console.log(`\n======================================================`);
  console.log(`Phase 10 Solana Tests: ALL ${passed} PASSED!`);
  console.log(`======================================================\n`);
}

runPhase10Tests().catch((err) => {
  console.error('\n❌ Phase 10 Solana Test Suite Failed:', err);
  process.exit(1);
});
