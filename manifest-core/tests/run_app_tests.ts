/**
 * Manifest Application Language v0.2 - Automated Test Suite
 * Comprehensive verification of application primitives:
 * APP, PAGE, TEXT, BUTTON, INPUT, IMAGE, FORM, STATE, ROUTE, and reactive web target execution.
 */

import { Lexer } from '../src/lexer/lexer.ts';
import { Parser } from '../src/parser/parser.ts';
import { Validator } from '../src/validator/validator.ts';
import { IRBuilder } from '../src/ir/ir-builder.ts';
import { JavaScriptTargetCompiler } from '../src/compiler/targets/js-target.ts';
import { ManifestError } from '../src/errors/manifest-error.ts';

export async function runAppTests(): Promise<{ passed: number; failed: number; total: number; results: any[] }> {
  const results: any[] = [];
  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, detail: string = '') {
    if (condition) {
      passed++;
      results.push({ name, passed: true });
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      results.push({ name, passed: false, detail });
      console.error(`  ✗ ${name} — ${detail}`);
    }
  }

  console.log('\n--- Running Manifest v0.2 Application Primitive Tests ---');

  // Helper pipeline
  function compileApp(source: string) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, source);
    const ast = parser.parse();
    const validator = new Validator(ast, source);
    validator.ensureValid();
    const irBuilder = new IRBuilder();
    const ir = irBuilder.build(ast);
    const compiler = new JavaScriptTargetCompiler();
    const compilation = compiler.compile(ir);
    const outputCode = compilation.outputCode || '';
    return { ast, ir, compilation, outputCode };
  }

  // 1. APP + PAGE
  try {
    const src = `
      APP "CounterApp"

      PAGE Home
          TEXT "Welcome to Counter"
      END
    `;
    const { ast, ir, compilation, outputCode } = compileApp(src);
    assert('1. APP + PAGE parses into IRPage', ir.pages !== undefined && ir.pages.length === 1 && ir.pages[0].name === 'Home');
    assert('1. APP + PAGE preserves appName in IR', ir.appName === 'CounterApp');
    assert('1. APP + PAGE generates registration in JS', outputCode.includes('__manifest.registerPage("Home"'));
  } catch (err: any) {
    assert('1. APP + PAGE parsing failed', false, err.message);
  }

  // 2. TEXT rendering
  try {
    const src = `
      APP "TextApp"

      PAGE Home
          TEXT "Hello Manifest World"
          TEXT "Status: " + 200
      END
    `;
    const { ir, compilation, outputCode } = compileApp(src);
    const page = ir.pages![0];
    assert('2. TEXT rendering: IR captures IRText nodes', page.children.length === 2 && page.children[0].kind === 'IRText');
    assert('2. TEXT rendering: JS target generates manifest-text DOM nodes', outputCode.includes('manifest-text'));
  } catch (err: any) {
    assert('2. TEXT rendering failed', false, err.message);
  }

  // 3. BUTTON rendering
  try {
    const src = `
      APP "ButtonApp"

      PAGE Home
          BUTTON "Click Me"
              WHEN CLICK
                  SHOW "Button was clicked"
              END
          END
      END
    `;
    const { ir, compilation, outputCode } = compileApp(src);
    const page = ir.pages![0];
    const btn = page.children[0];
    assert('3. BUTTON rendering: IR captures IRButton', btn.kind === 'IRButton');
    assert('3. BUTTON rendering: JS target generates manifest-button with onclick', outputCode.includes('manifest-button') && outputCode.includes('onclick = async'));
  } catch (err: any) {
    assert('3. BUTTON rendering failed', false, err.message);
  }

  // 4. STATE declaration
  try {
    const src = `
      APP "StateApp"

      PAGE Home
          STATE count TO 0
          STATE user TO "Alice"
      END
    `;
    const { ir, compilation, outputCode } = compileApp(src);
    assert('4. STATE declaration: IR captures state variables', ir.state !== undefined && ir.state.length === 2);
    assert('4. STATE declaration: JS initializes state in __manifest.state', outputCode.includes('__manifest.state["count"] =') && outputCode.includes('__manifest.state["user"] ='));
  } catch (err: any) {
    assert('4. STATE declaration failed', false, err.message);
  }

  // 5. STATE mutation & BUTTON event
  try {
    const src = `
      APP "Counter"

      PAGE Home
          STATE count TO 0

          TEXT "Count: " + count

          BUTTON "Increment"
              WHEN CLICK
                  SET count TO count + 1
              END
          END
      END
    `;
    const { ir, compilation, outputCode } = compileApp(src);
    const page = ir.pages![0];
    const btn = page.children.find((c) => c.kind === 'IRButton') as any;
    assert('5. STATE mutation: BUTTON captures WHEN CLICK handler', btn.eventHandlers.length === 1);
    assert('5. STATE mutation: JS click handler mutates state and calls notifyState', outputCode.includes('count = (count + 1)') && outputCode.includes('__manifest.notifyState()'));
  } catch (err: any) {
    assert('5. STATE mutation test failed', false, err.message);
  }

  // 6. Reactive state update in runtime execution
  try {
    const src = `
      APP "Counter"

      PAGE Home
          STATE count TO 0

          TEXT "Count: " + count

          BUTTON "Increment"
              WHEN CLICK
                  SET count TO count + 1
              END
          END
      END
    `;
    const { compilation, outputCode } = compileApp(src);

    // Test execution using mock runtime environment
    let renderedTexts: string[] = [];
    let stateUpdates: any[] = [];

    const mockDOM = {
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById(id: string) { return null; },
      createElement(tag: string) {
        return {
          tagName: tag,
          className: '',
          textContent: '',
          _innerHTML: '',
          get innerHTML() { return this._innerHTML; },
          set innerHTML(val: string) { this._innerHTML = val; if (val === '') this.children = []; },
          onclick: null as any,
          children: [] as any[],
          appendChild(child: any) {
            this.children.push(child);
            if (child.className === 'manifest-text') {
              renderedTexts.push(child.textContent);
            }
          },
        };
      },
    };

    // Execute generated code in a sandboxed Function (strip export keywords for Function eval)
    const executableCode = outputCode
      .replace(/\bexport\s+async\s+function\s+/g, 'async function ')
      .replace(/\bexport\s+/g, '');

    const runner = new Function('mockDoc', 'onStateUpdate', `
      const document = mockDoc;
      ${executableCode}
      return { startApp, __manifest };
    `);

    const { startApp, __manifest } = runner(mockDOM, (s: any) => stateUpdates.push(s));
    const mockRoot = mockDOM.createElement('div');
    await startApp({ mountElement: mockRoot });

    assert('6. Reactive runtime: startApp initializes state at 0', __manifest.state.count === 0);

    // Simulate clicking the button
    const appEl = mockRoot.children[0];
    const pageEl = appEl.children[0];
    const btnEl = pageEl.children.find((c: any) => c.className === 'manifest-button');
    assert('6. Reactive runtime: button DOM element exists', btnEl !== undefined && typeof btnEl.onclick === 'function');

    await btnEl.onclick({ preventDefault() {} });
    assert('7. Reactive runtime: click increments state to 1', __manifest.state.count === 1);

    await btnEl.onclick({ preventDefault() {} });
    assert('7. Reactive runtime: second click increments state to 2', __manifest.state.count === 2);
  } catch (err: any) {
    assert('6 & 7. Reactive runtime execution test failed', false, err.message);
  }

  // 8. INPUT primitive
  try {
    const src = `
      APP "InputApp"

      PAGE Home
          STATE username TO ""
          INPUT "Enter username" INTO username
      END
    `;
    const { ir, compilation, outputCode } = compileApp(src);
    const page = ir.pages![0];
    const inputNode = page.children.find((c) => c.kind === 'IRInput') as any;
    assert('8. INPUT: IR captures IRInput with placeholder and bindVariable', inputNode !== undefined && inputNode.bindVariable === 'username');
    assert('8. INPUT: JS generates manifest-input with oninput listener', outputCode.includes('manifest-input') && outputCode.includes('oninput = (e) =>'));
  } catch (err: any) {
    assert('8. INPUT test failed', false, err.message);
  }

  // 9. FORM primitive
  try {
    const src = `
      APP "FormApp"

      PAGE Home
          STATE email TO ""
          FORM ContactForm
              INPUT "Enter email" INTO email
              BUTTON "Send"
              WHEN SUBMIT
                  SHOW "Submitted: " + email
              END
          END
      END
    `;
    const { ir, compilation, outputCode } = compileApp(src);
    const page = ir.pages![0];
    const formNode = page.children.find((c) => c.kind === 'IRForm') as any;
    assert('9. FORM: IR captures IRForm with children and submit handler', formNode !== undefined && formNode.children.length === 2 && formNode.eventHandlers.length === 1);
    assert('9. FORM: JS generates manifest-form with preventDefault submit', outputCode.includes('manifest-form') && outputCode.includes('onsubmit = async (e) =>'));
  } catch (err: any) {
    assert('9. FORM test failed', false, err.message);
  }

  // 10. ROUTE primitive
  try {
    const src = `
      APP "RouteApp"

      ROUTE "/about" TO About

      PAGE Home ROUTE "/"
          TEXT "Home Page"
      END

      PAGE About ROUTE "/about"
          TEXT "About Page"
      END
    `;
    const { ir, compilation, outputCode } = compileApp(src);
    assert('10. ROUTE: IR captures route mappings', ir.routes !== undefined && ir.routes.length >= 1 && ir.routes[0].path === '/about');
    assert('10. ROUTE: JS registers routes and navigation', outputCode.includes('__manifest.registerRoute("/about", "About")'));
  } catch (err: any) {
    assert('10. ROUTE test failed', false, err.message);
  }

  // 11. Invalid application syntax & diagnostics
  try {
    // Missing page name
    try {
      const lexer = new Lexer('APP "Test"\nPAGE\nEND');
      const parser = new Parser(lexer.tokenize(), 'APP "Test"\nPAGE\nEND');
      parser.parse();
      assert('11. Diagnostic: PAGE missing name should throw', false, 'Parser did not throw');
    } catch (err: any) {
      assert('11. Diagnostic: PAGE missing name caught with friendly error', err instanceof ManifestError && err.message.includes('page name'));
    }

    // Missing STATE variable
    try {
      const lexer = new Lexer('APP "Test"\nSTATE TO 5');
      const parser = new Parser(lexer.tokenize(), 'APP "Test"\nSTATE TO 5');
      parser.parse();
      assert('11. Diagnostic: STATE missing variable should throw', false, 'Parser did not throw');
    } catch (err: any) {
      assert('11. Diagnostic: STATE missing variable caught with friendly error', err instanceof ManifestError && err.message.includes('state variable name'));
    }

    // Unclosed PAGE block
    try {
      const lexer = new Lexer('APP "Test"\nPAGE Home\nTEXT "Unclosed"');
      const parser = new Parser(lexer.tokenize(), 'APP "Test"\nPAGE Home\nTEXT "Unclosed"');
      parser.parse();
      assert('11. Diagnostic: Unclosed PAGE block should throw', false, 'Parser did not throw');
    } catch (err: any) {
      assert('11. Diagnostic: Unclosed PAGE block caught with friendly error', err instanceof ManifestError && err.message.includes('never closed with END'));
    }
  } catch (err: any) {
    assert('11. Diagnostic test suite error', false, err.message);
  }

  // 12. Generated web target artifact structure
  try {
    const src = `
      APP "FullApp"

      PAGE Home
          STATE counter TO 10
          TEXT "Value: " + counter
          BUTTON "Plus"
              WHEN CLICK
                  SET counter TO counter + 1
              END
          END
      END
    `;
    const { compilation, outputCode } = compileApp(src);
    assert('12. Web Target: compilation succeeds with artifacts', compilation.success && compilation.artifacts.length === 1);
    assert('12. Web Target: exports startApp function', outputCode.includes('export async function startApp'));
    assert('12. Web Target: includes runtime CSS styling injection', outputCode.includes('manifest-default-styles'));
  } catch (err: any) {
    assert('12. Web target test failed', false, err.message);
  }

  // 13. Preview Execution verification (DOM container rendering)
  try {
    const src = `
      APP "InteractiveApp"

      PAGE Main
          STATE message TO "Ready"
          TEXT message
          BUTTON "Activate"
              WHEN CLICK
                  SET message TO "Active!"
              END
          END
      END
    `;
    const { compilation, outputCode } = compileApp(src);
    let capturedState: any = null;

    const mockDOM = {
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById(id: string) { return null; },
      createElement(tag: string) {
        return {
          tagName: tag,
          className: '',
          textContent: '',
          _innerHTML: '',
          get innerHTML() { return this._innerHTML; },
          set innerHTML(val: string) { this._innerHTML = val; if (val === '') this.children = []; },
          onclick: null as any,
          children: [] as any[],
          appendChild(child: any) { this.children.push(child); },
        };
      },
    };

    const executableCode = outputCode
      .replace(/\bexport\s+async\s+function\s+/g, 'async function ')
      .replace(/\bexport\s+/g, '');

    const runner = new Function('mockDoc', `
      const document = mockDoc;
      ${executableCode}
      return { startApp, __manifest };
    `);

    const { startApp, __manifest } = runner(mockDOM);
    const rootEl = mockDOM.createElement('div');
    await startApp({
      mountElement: rootEl,
      onState: (s: any) => { capturedState = s; },
    });

    assert('13. Preview Execution: renders into mountElement without error', rootEl.children.length === 1);
    assert('13. Preview Execution: initial state reported to listener', capturedState !== null && capturedState.message === 'Ready');
  } catch (err: any) {
    assert('13. Preview execution test failed', false, err.message);
  }

  return { passed, failed, total: passed + failed, results };
}
