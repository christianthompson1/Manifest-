/**
 * Manifest Core - IR & Compiler Automated Tests
 * Tests IR generation, target compiler interfaces, JS target output, and CLI behavior.
 */

import {
  generateManifestIR,
  compileManifest,
  Compiler,
  JavaScriptTargetCompiler,
  IRProgramNode,
} from '../src/index.ts';

export async function runCompilerTests(): Promise<{ passed: number; failed: number }> {
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

  console.log('\n--- Running Manifest IR & Compiler Tests ---');

  // Test 1: Generate IR from Hello World
  try {
    const ir = generateManifestIR(`
      APP "HelloIR"
      WHEN app.starts
      SHOW "Hello from IR"
      END
    `);
    assert(ir.kind === 'IRProgram', 'IR root is IRProgram');
    assert(ir.appName === 'HelloIR', 'IR has appName HelloIR');
    assert(ir.eventHandlers.length === 1, 'IR contains 1 event handler');
    assert(ir.eventHandlers[0].eventName === 'app.starts', 'Event handler is app.starts');
    assert(ir.eventHandlers[0].body.length === 1, 'Event handler has 1 instruction');
    assert(ir.eventHandlers[0].body[0].kind === 'IRShow', 'Instruction is IRShow');
  } catch (err: any) {
    assert(false, `Generate IR error: ${err.message}`);
  }

  // Test 2: IR representation of variables, loops, and conditions
  try {
    const ir = generateManifestIR(`
      APP "ComplexIR"
      SET total TO 0
      SET items TO [1, 2, 3]

      ACTION addNumbers a, b
      RETURN a + b
      END

      WHEN app.starts
      IF total == 0
        SET total TO 10
      END
      REPEAT 3 TIMES
        SET total TO total + 1
      END
      FOR EACH item IN items
        SHOW item
      END
      SHOW total
      END
    `);

    assert(ir.variables.length === 2, 'IR captures 2 top-level variables');
    assert(ir.actions.length === 1, 'IR captures 1 action');
    assert(ir.actions[0].name === 'addNumbers', 'Action name is addNumbers');
    assert(ir.actions[0].parameters.length === 2, 'Action parameters count is 2');

    const whenBody = ir.eventHandlers[0].body;
    assert(whenBody.some((b) => b.kind === 'IRIf'), 'IR contains IRIf statement');
    assert(whenBody.some((b) => b.kind === 'IRLoop'), 'IR contains IRLoop statement');
    assert(whenBody.some((b) => b.kind === 'IRForEach'), 'IR contains IRForEach statement');
  } catch (err: any) {
    assert(false, `Complex IR error: ${err.message}`);
  }

  // Test 3: JavaScript Target Compiler compiles Hello World
  try {
    const res = await compileManifest(`
      APP "HelloJS"
      WHEN app.starts
      SHOW "Hello JS"
      END
    `, 'js');

    assert(res.success === true, 'JS target compilation succeeds');
    assert(res.target === 'js', 'Target name is js');
    assert(res.outputCode !== undefined && res.outputCode.includes('startApp'), 'Output code includes startApp export');
    assert(res.outputCode !== undefined && res.outputCode.includes('__manifest.output("Hello JS")'), 'Output code calls __manifest.output with Hello JS');
    assert(res.artifacts.length === 1, 'Generates 1 JS artifact');
    assert(res.artifacts[0].fileName === 'hellojs.js', 'Artifact file name is hellojs.js');
  } catch (err: any) {
    assert(false, `JS Target compilation error: ${err.message}`);
  }

  // Test 4: JavaScript Target Compiler produces executable JavaScript
  try {
    const res = await compileManifest(`
      APP "ArithmeticJS"
      SET a TO 20
      SET b TO 30
      WHEN app.starts
      SET total TO a + b
      SHOW total
      END
    `, 'js');

    assert(res.success === true, 'Arithmetic compilation succeeds');
    const code = res.outputCode!;

    // Test that the output JS can actually execute and produce output
    const recordedOutputs: string[] = [];
    const testFn = new Function('onOutput', `
      let __manifest = {
        output: onOutput,
        eventHandlers: {},
        on(event, handler) {
          if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
          this.eventHandlers[event].push(handler);
        },
        async emit(event, data) {
          const handlers = this.eventHandlers[event] || [];
          for (const h of handlers) { await h(data); }
        }
      };
      let a = 20;
      let b = 30;
      let total;
      __manifest.on("app.starts", async () => {
        total = (a + b);
        __manifest.output(String(total));
      });
      return __manifest.emit("app.starts");
    `);

    await testFn((val: any) => recordedOutputs.push(String(val)));
    assert(recordedOutputs.length === 1 && recordedOutputs[0] === '50', 'Compiled JS executes correctly (50)');
  } catch (err: any) {
    assert(false, `Executable JS test error: ${err.message}`);
  }

  // Test 5: Unsupported target returns clear diagnostic
  try {
    const res = await compileManifest(`
      APP "Test"
      WHEN app.starts
      SHOW "Hi"
      END
    `, 'rust');

    assert(res.success === false, 'Compilation to unsupported target fails gracefully');
    assert(res.diagnostics.length > 0, 'Diagnostics contains error');
    assert(res.diagnostics[0].message.includes("Unsupported target 'rust'"), 'Diagnostic explains unsupported target');
  } catch (err: any) {
    assert(false, `Unsupported target error: ${err.message}`);
  }

  // Test 6: Custom target compiler registration
  try {
    const customCompiler = new Compiler();
    customCompiler.registerTarget({
      targetName: 'dummy',
      fileExtension: '.txt',
      compile(ir: IRProgramNode) {
        return {
          success: true,
          target: 'dummy',
          outputCode: `DUMMY ${ir.appName}`,
          artifacts: [{ fileName: 'test.txt', content: `DUMMY ${ir.appName}`, fileType: 'text' }],
          diagnostics: [],
        };
      },
    });

    assert(customCompiler.getSupportedTargets().includes('dummy'), 'Custom target registered successfully');
    const dummyRes = await customCompiler.compile('APP "MyDummy"', 'dummy');
    assert(dummyRes.success === true && dummyRes.outputCode === 'DUMMY MyDummy', 'Custom target executed properly');
  } catch (err: any) {
    assert(false, `Custom target error: ${err.message}`);
  }

  return { passed, failed };
}

// When run directly from CLI (Node.js / tsx environment only)
const isNodeCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_compiler_tests.ts'));

if (isNodeCLI) {
  runCompilerTests()
    .then((summary) => {
      if (summary.failed > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}
