/**
 * Manifest Studio - Compiler, Linter & Runtime Performance Benchmark Suite
 * Measures stage-by-stage latency, memory delta, pathological inputs, and execution speed
 * across 100, 1,000, 5,000, 10,000, and 20,000 lines of Manifest code.
 */

import { Lexer } from '../src/lexer/lexer.ts';
import { Parser } from '../src/parser/parser.ts';
import { Validator } from '../src/validator/validator.ts';
import { IRBuilder } from '../src/ir/ir-builder.ts';
import { JSTargetCompiler } from '../src/compiler/targets/js-target.ts';
import { compileManifest } from '../src/compiler/compiler.ts';
import { inspectManifest } from '../src/index.ts';
import { Runtime } from '../src/runtime/runtime.ts';

interface BenchmarkRow {
  lineCount: number;
  lexMs: number;
  parseMs: number;
  validateMs: number;
  irMs: number;
  codegenMs: number;
  totalStagesMs: number;
  singlePassCompileMs: number;
  linterDiagnosticMs: number;
  heapDeltaKB: number;
  linesPerSec: number;
}

interface PathologicalRow {
  scenario: string;
  lineCount: number;
  compileMs: number;
  linterMs: number;
  success: boolean;
}

function generateRealisticManifestSource(targetLines: number): string {
  const lines: string[] = [];
  lines.push('APP "RealisticBenchmarkApp"');
  lines.push('');
  lines.push('STATE total TO 0');
  lines.push('STATE active TO true');
  lines.push('STATE items TO ["alpha", "beta", "gamma"]');
  lines.push('');
  lines.push('ACTION addDelta amount');
  lines.push('    IF amount > 0');
  lines.push('        SET total TO total + amount');
  lines.push('    ELSE');
  lines.push('        SET total TO total - 1');
  lines.push('    END');
  lines.push('    RETURN total');
  lines.push('END');
  lines.push('');
  lines.push('PAGE Home');
  lines.push('    STYLE');
  lines.push('        background: "#181818"');
  lines.push('        color: "#e5e5e5"');
  lines.push('        padding: 16');
  lines.push('    END');
  lines.push('    HEADING "Manifest Realistic Benchmark"');

  let sectionIdx = 0;
  while (lines.length < targetLines - 16) {
    sectionIdx++;
    lines.push(`    CONTAINER`);
    lines.push(`        STYLE`);
    lines.push(`            padding: 12`);
    lines.push(`            gap: 8`);
    lines.push(`            background: "#252526"`);
    lines.push(`            radius: 6`);
    lines.push(`        END`);
    lines.push(`        TEXT "Section ${sectionIdx}: " + total`);
    lines.push(`        BUTTON "Apply ${sectionIdx}"`);
    lines.push(`            WHEN CLICK`);
    lines.push(`                CALL addDelta ${sectionIdx}`);
    lines.push(`            END`);
    lines.push(`        END`);
    lines.push(`    END`);
  }

  lines.push('END');
  return lines.join('\n');
}

function generateDeepExpressionSource(depth: number): string {
  let expr = '1';
  for (let i = 2; i <= depth; i++) {
    const op = i % 3 === 0 ? '*' : i % 2 === 0 ? '+' : '-';
    expr = `(${expr} ${op} ${i})`;
  }
  return [
    'APP "DeepExprBenchmark"',
    'WHEN app.starts',
    `    SET result TO ${expr}`,
    '    SHOW result',
    'END',
  ].join('\n');
}

function generateDeepContainerSource(depth: number): string {
  const lines: string[] = ['APP "DeepContainerBenchmark"', 'PAGE Home'];
  for (let i = 0; i < depth; i++) {
    lines.push(`${'  '.repeat(i + 1)}CONTAINER`);
    lines.push(`${'  '.repeat(i + 2)}STYLE`);
    lines.push(`${'  '.repeat(i + 3)}padding: 4`);
    lines.push(`${'  '.repeat(i + 2)}END`);
  }
  lines.push(`${'  '.repeat(depth + 1)}TEXT "Deep Leaf Node"`);
  for (let i = depth - 1; i >= 0; i--) {
    lines.push(`${'  '.repeat(i + 1)}END`);
  }
  lines.push('END');
  return lines.join('\n');
}

function generateForwardActionStressSource(actionCount: number): string {
  const lines: string[] = ['APP "ForwardActionStress"', 'WHEN app.starts'];
  for (let i = 1; i <= Math.min(actionCount, 50); i++) {
    lines.push(`    CALL action_${actionCount - i + 1} ${i}`);
  }
  lines.push('END');
  for (let i = 1; i <= actionCount; i++) {
    lines.push(`ACTION action_${i} x`);
    lines.push(`    RETURN x + ${i}`);
    lines.push('END');
  }
  return lines.join('\n');
}

function createMinimalMockDOM() {
  class El {
    tagName: string;
    className = '';
    id = '';
    textContent = '';
    children: El[] = [];
    parentNode: El | null = null;
    onclick: ((e: any) => any) | null = null;
    style: Record<string, any> = {
      setProperty(k: string, v: string) {
        this[k] = v;
      },
      getPropertyValue(k: string) {
        return this[k] || '';
      },
    };
    constructor(tag: string) {
      this.tagName = tag.toUpperCase();
    }
    appendChild(child: El) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    addEventListener() {}
    set innerHTML(v: string) {
      if (v === '') this.children = [];
    }
  }
  return {
    Element: El,
    document: {
      body: new El('body'),
      head: new El('head'),
      createElement: (t: string) => new El(t),
    },
  };
}

async function runBenchmark() {
  console.log('================================================================================');
  console.log('   MANIFEST STUDIO - COMPILER, LINTER & RUNTIME BENCHMARK SUITE (Node v22)      ');
  console.log('================================================================================\n');

  const sizes = [100, 1000, 5000, 10000, 20000];
  const results: BenchmarkRow[] = [];

  // JIT Warm-up
  const warmSrc = generateRealisticManifestSource(200);
  await compileManifest(warmSrc, 'js');
  inspectManifest(warmSrc);

  console.log('1. REALISTIC MULTI-CONSTRUCT PIPELINE SCALING');
  console.log('--------------------------------------------------------------------------------');

  for (const size of sizes) {
    const source = generateRealisticManifestSource(size);
    const actualLines = source.split('\n').length;

    const heapBefore = process.memoryUsage().heapUsed;

    // Stage 1: Lexer
    const t0 = performance.now();
    const tokens = new Lexer(source).tokenize();
    const t1 = performance.now();
    const lexMs = t1 - t0;

    // Stage 2: Parser
    const t2 = performance.now();
    const ast = new Parser(tokens, source).parse();
    const t3 = performance.now();
    const parseMs = t3 - t2;

    // Stage 3: Two-Pass Semantic Validator
    const t4 = performance.now();
    const valRes = new Validator(ast, source).validate();
    const t5 = performance.now();
    const validateMs = t5 - t4;
    if (!valRes.isValid) {
      throw new Error(`Benchmark validation unexpectedly failed at ${actualLines} lines: ${valRes.issues[0]?.message}`);
    }

    // Stage 4: IR Lowering
    const t6 = performance.now();
    const ir = new IRBuilder().build(ast);
    const t7 = performance.now();
    const irMs = t7 - t6;

    // Stage 5: JS Target Codegen
    const t8 = performance.now();
    const jsOut = new JSTargetCompiler().compile(ir);
    const t9 = performance.now();
    const codegenMs = t9 - t8;
    if (!jsOut.success) {
      throw new Error(`Benchmark codegen failed at ${actualLines} lines`);
    }

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaKB = Math.max(0, Math.round((heapAfter - heapBefore) / 1024));

    // End-to-end single-pass compileManifest()
    const sp0 = performance.now();
    await compileManifest(source, 'js');
    const singlePassCompileMs = performance.now() - sp0;

    // Editor diagnostic linter pass (inspectManifest)
    const lp0 = performance.now();
    inspectManifest(source);
    const linterDiagnosticMs = performance.now() - lp0;

    const totalStagesMs = lexMs + parseMs + validateMs + irMs + codegenMs;
    const linesPerSec = Math.round(actualLines / (singlePassCompileMs / 1000));

    results.push({
      lineCount: actualLines,
      lexMs: Number(lexMs.toFixed(2)),
      parseMs: Number(parseMs.toFixed(2)),
      validateMs: Number(validateMs.toFixed(2)),
      irMs: Number(irMs.toFixed(2)),
      codegenMs: Number(codegenMs.toFixed(2)),
      totalStagesMs: Number(totalStagesMs.toFixed(2)),
      singlePassCompileMs: Number(singlePassCompileMs.toFixed(2)),
      linterDiagnosticMs: Number(linterDiagnosticMs.toFixed(2)),
      heapDeltaKB,
      linesPerSec,
    });

    console.log(
      `✓ [${actualLines.toString().padStart(5)} lines] Lex: ${lexMs.toFixed(2)}ms | Parse: ${parseMs.toFixed(2)}ms | Val: ${validateMs.toFixed(2)}ms | IR: ${irMs.toFixed(2)}ms | JS: ${codegenMs.toFixed(2)}ms | 1-Pass: ${singlePassCompileMs.toFixed(2)}ms | Lint: ${linterDiagnosticMs.toFixed(2)}ms | Heap: +${heapDeltaKB}KB (${linesPerSec.toLocaleString()} loc/s)`
    );
  }

  console.log('\n2. PATHOLOGICAL INPUT STRESS TESTS');
  console.log('--------------------------------------------------------------------------------');
  const pathologicalInputs: Array<{ name: string; source: string }> = [
    { name: '120-deep nested binary arithmetic expression', source: generateDeepExpressionSource(120) },
    { name: '25-level nested CONTAINER hierarchy with STYLE', source: generateDeepContainerSource(25) },
    { name: '500 ACTION symbol table + forward CALL resolution', source: generateForwardActionStressSource(500) },
  ];

  const pathologicalResults: PathologicalRow[] = [];
  for (const item of pathologicalInputs) {
    const pLines = item.source.split('\n').length;
    const c0 = performance.now();
    const cRes = await compileManifest(item.source, 'js');
    const cMs = performance.now() - c0;

    const l0 = performance.now();
    const lRes = inspectManifest(item.source);
    const lMs = performance.now() - l0;

    const ok = cRes.success && Boolean(lRes.validation?.isValid);
    pathologicalResults.push({
      scenario: item.name,
      lineCount: pLines,
      compileMs: Number(cMs.toFixed(2)),
      linterMs: Number(lMs.toFixed(2)),
      success: ok,
    });
    console.log(
      `✓ ${item.name.padEnd(50)} | ${pLines.toString().padStart(4)} lines | Compile: ${cMs.toFixed(2)}ms | Lint: ${lMs.toFixed(2)}ms | Valid: ${ok}`
    );
  }

  console.log('\n3. RUNTIME EXECUTION & DOM MOUNT BENCHMARKS');
  console.log('--------------------------------------------------------------------------------');

  for (const iterCount of [100, 10000]) {
    const rtSource = [
      'APP "RuntimeLoopBench"',
      'SET count TO 0',
      'SET sum TO 0',
      `REPEAT ${iterCount} TIMES`,
      '    SET count TO count + 1',
      '    SET sum TO sum + count',
      'END',
      'SHOW sum',
    ].join('\n');
    const rtAst = new Parser(new Lexer(rtSource).tokenize(), rtSource).parse();
    const runtime = new Runtime();
    const r0 = performance.now();
    await runtime.execute(rtAst);
    const rMs = performance.now() - r0;
    console.log(
      `✓ AST Interpreter (${iterCount.toLocaleString().padStart(6)} loop iterations): ${rMs.toFixed(2)}ms (Output: ${runtime.getLogs()[0]})`
    );
  }

  for (const uiLines of [100, 1000]) {
    const uiSrc = generateRealisticManifestSource(uiLines);
    const compiled = await compileManifest(uiSrc, 'js');
    const { document, Element } = createMinimalMockDOM();
    const mountRoot = document.createElement('div');
    const execBody =
      (compiled.outputCode || '')
        .replace('export const __manifest =', 'const __manifest =')
        .replace('export async function startApp', 'async function startApp') +
      '\nreturn { startApp, __manifest };';
    const mod = new Function('document', 'Element', execBody)(document, Element);
    const m0 = performance.now();
    await mod.startApp(mountRoot);
    const mountMs = performance.now() - m0;
    console.log(
      `✓ Compiled JS DOM Mount (${uiSrc.split('\n').length.toString().padStart(4)} lines -> ${mountRoot.children[0]?.children.length || 0} sections): ${mountMs.toFixed(2)}ms`
    );
  }

  console.log('\n================================================================================');
  console.log('JSON SUMMARY:');
  console.log(JSON.stringify({ scaling: results, pathological: pathologicalResults }, null, 2));
}

runBenchmark().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
