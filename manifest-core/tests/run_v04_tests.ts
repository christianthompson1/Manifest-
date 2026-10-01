/**
 * Manifest Studio v0.4 - Automated Test Suite
 * Tests Solana Development Foundation, Anchor Rust generation, IDL generation,
 * Fast Local Solana Simulator, Library Registry & Capability Security,
 * CSS/JS/Rust Escape Hatches, and Universal Language Provider Registry.
 */

import { Lexer } from '../src/lexer/lexer.ts';
import { Parser } from '../src/parser/parser.ts';
import { Validator } from '../src/validator/validator.ts';
import { IRBuilder } from '../src/ir/ir-builder.ts';
import { AnchorGenerator } from '../src/solana/anchor-generator.ts';
import { SolanaSimulator } from '../src/solana/solana-simulator.ts';
import { LibraryRegistry } from '../src/libraries/library-registry.ts';
import { LanguageRegistry } from '../../src/studio/languages/language-registry.ts';

export function runV04Tests(): { passed: number; failed: number; total: number } {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✓ ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
      failed++;
    }
  }

  console.log('\n--- Running Manifest v0.4 Solana, IDE & Language Architecture Tests ---');

  // Test 1: Explicit typed state and assignment operator: STATE count: NUMBER = 0
  try {
    const source = `
      APP "TypedStateApp"
      PAGE Home
          STATE count: NUMBER = 42
          STATE active: BOOLEAN = true
          STATE title: TEXT = "Manifest v0.4"
          BUTTON "Increment"
              WHEN CLICK
                  SET count = count + 1
              END
          END
      END
    `;
    const tokens = new Lexer(source).tokenize();
    const ast = new Parser(tokens, source).parse();
    const validator = new Validator(ast, source);
    const validation = validator.validate();
    assert(validation.isValid, '1. Explicit typed state parses & validates cleanly');

    const ir = new IRBuilder().build(ast);
    const homePage = ir.pages?.find((p) => p.name === 'Home');
    assert(homePage !== undefined, '1. Home page IR node generated');
    const hasCountState = Boolean(homePage?.state?.some((s) => s.name === 'count') || ir.state?.some((s) => s.name === 'count'));
    assert(hasCountState, '1. State variable count captured in IR');
  } catch (err: any) {
    assert(false, `1. Typed state test error: ${err.message}`);
  }

  // Test 2: Solana Anchor smart contract code generation
  try {
    const solanaProgram = {
      programName: 'VaultProgram',
      programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      accounts: [
        {
          name: 'VaultState',
          fields: [
            { name: 'owner', fieldType: 'pubkey' as const },
            { name: 'balance', fieldType: 'u64' as const },
          ],
        },
      ],
      instructions: [
        {
          name: 'deposit',
          accounts: [
            { name: 'vault', isMut: true, isSigner: false, accountType: 'VaultState' },
            { name: 'user', isMut: true, isSigner: true },
          ],
          requires: ['signer = user'],
          mutations: [{ target: 'vault.balance', expression: 'vault.balance + amount' }],
          cpis: [],
        },
      ],
    };

    const generated = AnchorGenerator.generate(solanaProgram);
    assert(generated.rustCode.includes('declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");'), '2. Generates declare_id! macro');
    assert(generated.rustCode.includes('#[program]'), '2. Generates #[program] attribute');
    assert(generated.rustCode.includes('pub mod vault_program {'), '2. Generates snake_case module');
    assert(generated.rustCode.includes('#[derive(Accounts)]'), '2. Generates #[derive(Accounts)] context struct');
    assert(generated.rustCode.includes('#[account]'), '2. Generates #[account] data struct');
    assert(generated.rustCode.includes('pub struct VaultState {'), '2. Generates PascalCase account struct');
    assert(generated.idl.name === 'vault_program', '2. Generates valid IDL JSON metadata');
    assert(generated.idl.instructions.length === 1, '2. Generates IDL instruction entry');
    assert(generated.idl.accounts.length === 1, '2. Generates IDL account entry');
  } catch (err: any) {
    assert(false, `2. Anchor generator error: ${err.message}`);
  }

  // Test 3: Fast Local Solana Simulator
  try {
    const simulator = new SolanaSimulator();
    const initialLamports = 1000000;
    const userPubkey = simulator.createAccount('UserAccount', initialLamports, 'system');
    const vaultPubkey = simulator.createAccount('VaultAccount', 50000, 'vault_program', {
      owner: userPubkey,
      balance: 50,
    });

    assert(simulator.getAccount(userPubkey)?.lamports === initialLamports, '3. Simulator initializes user account with lamports');
    assert(simulator.getAccount(vaultPubkey)?.data.balance === 50, '3. Simulator initializes vault state data');

    // Transfer lamports via simulator
    const tx = simulator.transferLamports(userPubkey, vaultPubkey, 25000);
    assert(tx.success === true, '3. Simulator executes transaction successfully');
    assert(simulator.getAccount(userPubkey)?.lamports === initialLamports - 25000, '3. User lamports decremented');
    assert(simulator.getAccount(vaultPubkey)?.lamports === 75000, '3. Vault lamports incremented');
    assert(simulator.getTransactions().length >= 1, '3. Simulator records transaction history');
  } catch (err: any) {
    assert(false, `3. Solana simulator error: ${err.message}`);
  }

  // Test 4: Library Registry & Capability Permissions
  try {
    const registry = LibraryRegistry.getInstance();
    const framer = registry.getLibrary('framer-motion');
    const solanaWeb3 = registry.getLibrary('solana-web3');

    assert(framer !== undefined, '4. Library framer-motion is registered');
    assert(Boolean(framer?.capabilities.includes('animation')), '4. Framer motion declares animation capability');
    assert(solanaWeb3 !== undefined, '4. Library solana-web3 is registered');
    assert(Boolean(solanaWeb3?.capabilities.includes('wallet') && solanaWeb3?.capabilities.includes('network')), '4. solana-web3 declares wallet & network capabilities');

    const validation = registry.validateManifestLibraries([
      { name: 'framer-motion', requestedCapabilities: ['animation'] },
      { name: 'solana-web3', requestedCapabilities: ['wallet', 'network'] },
    ]);
    assert(validation.valid === true, '4. Library capabilities validated securely');
  } catch (err: any) {
    assert(false, `4. Library registry error: ${err.message}`);
  }

  // Test 5: Universal Language Provider Registry (All 22 Languages + Web/Data Formats)
  try {
    const langRegistry = LanguageRegistry.getInstance();

    // Check key programming languages
    const rustProv = langRegistry.detectProvider('src/lib.rs');
    assert(rustProv.id === 'rust', '5. Detects Rust language provider');
    assert(rustProv.capabilities.localRun === false && rustProv.capabilities.cloudBuild === true, '5. Rust provider honestly declares offline vs cloud capabilities');

    const pyProv = langRegistry.detectProvider('scripts/train.py');
    assert(pyProv.id === 'python', '5. Detects Python language provider');

    const goProv = langRegistry.detectProvider('cmd/main.go');
    assert(goProv.id === 'go', '5. Detects Go language provider');

    const cppProv = langRegistry.detectProvider('native/engine.cpp');
    assert(cppProv.id === 'cpp', '5. Detects C++ language provider');

    const sqlProv = langRegistry.detectProvider('migrations/001_init.sql');
    assert(sqlProv.id === 'sql', '5. Detects SQL language provider');

    const manifestProv = langRegistry.detectProvider('src/main.manifest');
    assert(manifestProv.id === 'manifest', '5. Detects Manifest first-class language provider');
    assert(manifestProv.capabilities.completion === 'native' && manifestProv.capabilities.localRun === true, '5. Manifest provider has native local runtime and completion');

    const dockerProv = langRegistry.detectProvider('Dockerfile');
    assert(dockerProv.id === 'dockerfile', '5. Detects Dockerfile by exact filename match');
  } catch (err: any) {
    assert(false, `5. Language registry error: ${err.message}`);
  }

  // Test 6: CSS & JS Escape Hatch support in Manifest
  try {
    const source = `
      APP "EscapeHatchApp"
      CSS
        .custom-glow {
          box-shadow: 0 0 20px rgba(59, 130, 246, 0.5);
        }
      END

      JS
        const timestamp = Date.now();
      END

      PAGE Home
          TEXT "Escape hatch test"
      END
    `;
    const tokens = new Lexer(source).tokenize();
    const ast = new Parser(tokens, source).parse();
    assert(ast.statements.some((s) => s.type === 'CssEscape'), '6. AST captures CssEscape block');
    assert(ast.statements.some((s) => s.type === 'JsEscape'), '6. AST captures JsEscape block');
  } catch (err: any) {
    assert(false, `6. Escape hatches error: ${err.message}`);
  }

  const total = passed + failed;
  console.log(`Manifest v0.4 tests completed: ${passed}/${total} passed.`);
  return { passed, failed, total };
}
