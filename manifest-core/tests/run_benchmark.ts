/**
 * Manifest Studio - Compiler & Runtime Performance Benchmark Suite
 * Measures latency and throughput across 100, 1,000, 5,000, 10,000, and 20,000 lines.
 */

import { Lexer } from '../src/lexer/lexer.ts';
import { Parser } from '../src/parser/parser.ts';
import { Validator } from '../src/validator/validator.ts';
import { IRBuilder } from '../src/ir/ir-builder.ts';
import { JSTargetCompiler } from '../src/compiler/targets/js-target.ts';
import { Runtime } from '../src/runtime/runtime.ts';

interface BenchmarkRow {
  lineCount: number;
  lexMs: number;
  parseMs: number;
  validateMs: number;
  irMs: number;
  codegenMs: number;
  totalPipelineMs: number;
  linesPerSec: number;
}

function generateManifestSource(targetLines: number): string {
  const lines: string[] = [];
  lines.push('APP "BenchmarkApp"');
  lines.push('');
  lines.push('STATE total: NUMBER = 0');
  lines.push('STATE active: BOOLEAN = true');
  lines.push('');
  lines.push('PAGE Home');
  lines.push('    TEXT "Manifest Benchmark Suite"');

  let currentLine = lines.length;
  let actionIdx = 0;

  while (currentLine < targetLines - 15) {
    actionIdx++;
    lines.push(`    CONTAINER`);
    lines.push(`        TEXT "Section ${actionIdx}"`);
    lines.push(`        BUTTON "Click ${actionIdx}"`);
    lines.push(`            WHEN CLICK`);
    lines.push(`                SET total = total + ${actionIdx}`);
    lines.push(`            END`);
    lines.push(`        END`);
    lines.push(`    END`);
    currentLine += 8;
  }

  lines.push('END');
  lines.push('');
  lines.push('ACTION computeSum n');
  lines.push('    SET acc TO 0');
  lines.push('    REPEAT 5 TIMES');
  lines.push('        SET acc TO acc + n');
  lines.push('    END');
  lines.push('    RETURN acc');
  lines.push('END');

  return lines.join('\n');
}

async function runBenchmark() {
  console.log('================================================================');
  console.log('   MANIFEST STUDIO - COMPILER PIPELINE BENCHMARK (Node v22)    ');
  console.log('================================================================\n');

  const sizes = [100, 1000, 5000, 10000, 20000];
  const results: BenchmarkRow[] = [];

  for (const size of sizes) {
    const source = generateManifestSource(size);
    const actualLines = source.split('\n').length;

    // Warm-up iteration
    const warmLex = new Lexer(source).tokenize();
    const warmAst = new Parser(warmLex, source).parse();

    // 1. Lexer
    const t0 = performance.now();
    const tokens = new Lexer(source).tokenize();
    const t1 = performance.now();
    const lexMs = t1 - t0;

    // 2. Parser
    const t2 = performance.now();
    const ast = new Parser(tokens, source).parse();
    const t3 = performance.now();
    const parseMs = t3 - t2;

    // 3. Validator
    const t4 = performance.now();
    const validator = new Validator(ast, source);
    const valRes = validator.validate();
    const t5 = performance.now();
    const validateMs = t5 - t4;

    // 4. IR Builder
    const t6 = performance.now();
    const ir = new IRBuilder().build(ast);
    const t7 = performance.now();
    const irMs = t7 - t6;

    // 5. Code Generator (JS Target)
    const t8 = performance.now();
    const compiler = new JSTargetCompiler();
    const compilation = await compiler.compile(ir);
    const t9 = performance.now();
    const codegenMs = t9 - t8;

    const totalPipelineMs = lexMs + parseMs + validateMs + irMs + codegenMs;
    const linesPerSec = Math.round((actualLines / (totalPipelineMs / 1000)));

    results.push({
      lineCount: actualLines,
      lexMs: Number(lexMs.toFixed(2)),
      parseMs: Number(parseMs.toFixed(2)),
      validateMs: Number(validateMs.toFixed(2)),
      irMs: Number(irMs.toFixed(2)),
      codegenMs: Number(codegenMs.toFixed(2)),
      totalPipelineMs: Number(totalPipelineMs.toFixed(2)),
      linesPerSec,
    });

    console.log(
      `✓ [${actualLines.toString().padStart(5)} lines] Lex: ${lexMs.toFixed(1)}ms | Parse: ${parseMs.toFixed(1)}ms | Validate: ${validateMs.toFixed(1)}ms | IR: ${irMs.toFixed(1)}ms | Codegen: ${codegenMs.toFixed(1)}ms | Total: ${totalPipelineMs.toFixed(1)}ms (${linesPerSec.toLocaleString()} lines/sec)`
    );
  }

  // Runtime test on 100-line AST
  const runtimeSource = `
APP "RuntimeBenchmark"
SET count TO 0
SET sum TO 0
REPEAT 100 TIMES
    SET count TO count + 1
    SET sum TO sum + count
END
SHOW sum
`;
  const rtTokens = new Lexer(runtimeSource).tokenize();
  const rtAst = new Parser(rtTokens, runtimeSource).parse();
  const runtime = new Runtime();
  const rtStart = performance.now();
  await runtime.execute(rtAst);
  const rtDuration = performance.now() - rtStart;
  console.log(`\n✓ In-memory AST Interpreter (100 loop iterations): ${rtDuration.toFixed(2)}ms (Result: ${runtime.getLogs()[0]})`);

  console.log('\n================================================================');
  console.log('JSON RESULTS FOR PERFORMANCE DOCUMENTATION:');
  console.log(JSON.stringify(results, null, 2));
}

runBenchmark().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
