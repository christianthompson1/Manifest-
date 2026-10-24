/**
 * Manifest Core - Styled Dashboard Verification Test Suite (Phase 5)
 * Verifies end-to-end rendering pipeline:
 * - Parsing of canonical styled Manifest code
 * - Preservation of styles in IR
 * - JavaScript & CSS code generation
 * - Runtime execution, DOM element structure, and computed styles
 * - Reactive counter update on button click (0 -> 1)
 * - Safe preview refresh without DOM duplication
 * - Error reporting on invalid syntax and runtime issues
 */

import { Lexer } from '../src/lexer/lexer.ts';
import { Parser } from '../src/parser/parser.ts';
import { Validator } from '../src/validator/validator.ts';
import { IRBuilder } from '../src/ir/ir-builder.ts';
import { JSTargetCompiler } from '../src/compiler/targets/js-target.ts';
import { ManifestError } from '../src/errors/manifest-error.ts';

export const STYLED_DASHBOARD_EXAMPLE = `
APP "StyledDashboardVerification"

PAGE Home
    STYLE
        background: "#0f172a"
        color: "#f8fafc"
    END

    STATE counter TO 0

    CONTAINER
        STYLE
            display: "flex"
            direction: "column"
            gap: 16
            padding: 24
            radius: 16
            background: "#1e293b"
            maxWidth: 600
        END

        TEXT "Styled Dashboard Verification"
            STYLE
                color: "#60a5fa"
                font_size: 28
                font_weight: "bold"
            END

        TEXT "Counter: " + counter
            STYLE
                color: "#38bdf8"
                font_size: 18
            END

        BUTTON "Increment Counter"
            STYLE
                background: "#3b82f6"
                color: "#ffffff"
                padding: 12 24
                radius: 8
                font_weight: 600
            END
            WHEN CLICK
                SET counter TO counter + 1
            END
        END
    END
END
`;

/**
 * Lightweight mock DOM environment for evaluating the generated JavaScript runtime in Node.js
 */
function createMockDOM() {
  class MockCSSStyleDeclaration {
    private _props: Record<string, string> = {};
    [key: string]: any;

    setProperty(prop: string, val: string) {
      this._props[prop] = val;
      const camel = prop.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this._props[camel] = val;
      (this as any)[camel] = val;
      (this as any)[prop] = val;
    }

    getPropertyValue(prop: string): string {
      return this._props[prop] || '';
    }
  }

  class MockElement {
    tagName: string;
    className = '';
    id = '';
    textContent = '';
    children: MockElement[] = [];
    parentNode: MockElement | null = null;
    style: any;
    onclick: ((e: any) => void) | null = null;
    listeners: Record<string, Function[]> = {};

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
      const styleObj = new MockCSSStyleDeclaration();
      this.style = new Proxy(styleObj, {
        set: (target, prop: string, val) => {
          target.setProperty(prop, String(val));
          return true;
        },
        get: (target, prop: string) => {
          if (prop === 'setProperty') return target.setProperty.bind(target);
          if (prop === 'getPropertyValue') return target.getPropertyValue.bind(target);
          return (target as any)[prop] || target.getPropertyValue(prop);
        },
      });
    }

    appendChild(child: MockElement) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    addEventListener(event: string, fn: Function) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    set innerHTML(val: string) {
      if (val === '') {
        this.children = [];
        this.textContent = '';
      }
    }

    querySelector(selector: string): MockElement | null {
      for (const child of this.children) {
        if (selector.startsWith('.') && child.className.includes(selector.slice(1))) {
          return child;
        }
        if (selector.startsWith('#') && child.id === selector.slice(1)) {
          return child;
        }
        if (child.tagName.toLowerCase() === selector.toLowerCase()) {
          return child;
        }
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    }

    querySelectorAll(selector: string): MockElement[] {
      const results: MockElement[] = [];
      for (const child of this.children) {
        if (selector.startsWith('.') && child.className.includes(selector.slice(1))) {
          results.push(child);
        } else if (child.tagName.toLowerCase() === selector.toLowerCase()) {
          results.push(child);
        }
        results.push(...child.querySelectorAll(selector));
      }
      return results;
    }
  }

  const mockBody = new MockElement('body');
  const mockHead = new MockElement('head');

  const mockDocument = {
    body: mockBody,
    head: mockHead,
    createElement: (tag: string) => new MockElement(tag),
  };

  return { mockDocument, MockElement };
}

export async function runStyledDashboardTests(): Promise<{ passed: number; failed: number; total: number }> {
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

  console.log('\n--- Running Styled Dashboard Verification Pipeline Tests (Phase 5) ---');

  // 1. Check 1: Parser accepts the example
  let ast: any;
  try {
    const tokens = new Lexer(STYLED_DASHBOARD_EXAMPLE).tokenize();
    assert(tokens.length > 0, '1. Tokenizer produces valid tokens for styled example');

    const parser = new Parser(tokens, STYLED_DASHBOARD_EXAMPLE);
    ast = parser.parse();
    assert(ast && (ast.type === 'AppDeclaration' || ast.type === 'Program'), '1. Parser accepts canonical Styled Dashboard example');
    assert((ast.body || ast.statements || []).some((s: any) => s.type === 'PageDeclaration'), '1. AST includes PageDeclaration node');
  } catch (err: any) {
    assert(false, `1. Parser failure: ${err.message}`);
  }

  // 2. Check 2: Validator validates and IR retains style & layout properties
  let ir: any;
  try {
    const validator = new Validator(ast, STYLED_DASHBOARD_EXAMPLE);
    const valResult = validator.validate();
    assert(valResult.isValid, '2. Validator passes styled example with 0 errors');

    const irBuilder = new IRBuilder();
    ir = irBuilder.build(ast);
    assert(ir && ir.kind === 'IRProgram', '2. IRBuilder generates IRProgram');

    const page = ir.pages?.find((p: any) => p.name === 'Home');
    assert(page !== undefined, '2. IR captures Home Page');
    assert(page.styles?.background === '#0f172a', '2. IR retains Page background: #0f172a');
    assert(page.styles?.color === '#f8fafc', '2. IR retains Page text color: #f8fafc');

    const container = page.children?.find((c: any) => c.kind === 'IRContainer');
    assert(container !== undefined, '2. IR captures Container inside Page');
    assert(container.styles?.padding === '24px', '2. IR retains Container padding: 24px');
    assert(container.styles?.borderRadius === '16px', '2. IR retains Container borderRadius: 16px');
    assert(container.styles?.background === '#1e293b', '2. IR retains Container background: #1e293b');

    const textNodes = container.children?.filter((c: any) => c.kind === 'IRText');
    assert(textNodes?.length >= 2, '2. IR captures Heading and Counter Text nodes');
    assert(textNodes[0].styles?.color === '#60a5fa', '2. IR retains Heading color: #60a5fa');
    assert(textNodes[0].styles?.fontSize === '28px', '2. IR retains Heading fontSize: 28px');

    const button = container.children?.find((c: any) => c.kind === 'IRButton');
    assert(button !== undefined, '2. IR captures primary Button');
    assert(button.styles?.background === '#3b82f6', '2. IR retains Button background: #3b82f6');
    assert(button.styles?.color === '#ffffff', '2. IR retains Button color: #ffffff');
    assert(button.styles?.borderRadius === '8px', '2. IR retains Button borderRadius: 8px');
  } catch (err: any) {
    assert(false, `2. IR generation failure: ${err.message}`);
  }

  // 3. Check 3: JS Target compilation
  let compiledJs = '';
  try {
    const compiler = new JSTargetCompiler();
    const result = compiler.compile(ir);
    assert(result.success, '3. JS Compiler succeeds for styled example');
    compiledJs = result.outputCode || '';
    assert(compiledJs.includes('export async function startApp'), '3. Output exports startApp');
    assert(compiledJs.includes('.manifest-page'), '3. Output contains .manifest-page styling');
    assert(compiledJs.includes('#0f172a'), '3. Output contains page background #0f172a');
    assert(compiledJs.includes('#3b82f6'), '3. Output contains button background #3b82f6');
  } catch (err: any) {
    assert(false, `3. Target compiler failure: ${err.message}`);
  }

  // 4, 5, 6, 7. Runtime DOM execution, Computed Styles, Button Click & Refresh
  try {
    const { mockDocument, MockElement } = createMockDOM();
    const mountRoot = mockDocument.createElement('div');

    // Prepare sandbox evaluation of generated code
    // Convert ES export to local closure returning startApp
    const executableCode = compiledJs
      .replace('export const __manifest =', 'const __manifest =')
      .replace('export async function startApp', 'async function startApp') +
      '\nreturn { startApp, __manifest };';

    const fn = new Function('document', 'Element', executableCode);
    const runtime = fn(mockDocument, MockElement);

    let stateNotifications: any[] = [];
    await runtime.startApp(mountRoot, {
      onState: (st: any) => stateNotifications.push(st),
    });

    // Check 4: Correct DOM structure created
    const pageEl = mountRoot.querySelector('.manifest-page');
    assert(pageEl !== null, '4. Runtime creates .manifest-page DOM element');

    const containerEl = mountRoot.querySelector('.manifest-container');
    assert(containerEl !== null, '4. Runtime creates .manifest-container DOM element');

    const buttonEl = mountRoot.querySelector('.manifest-button');
    assert(buttonEl !== null, '4. Runtime creates .manifest-button DOM element');

    const textElements = mountRoot.querySelectorAll('.manifest-text');
    assert(textElements.length >= 2, '4. Runtime creates both text elements');
    assert(textElements[1].textContent.includes('0'), '4. Counter text initialized to 0');

    // Check 5: Primary button receives expected computed styles
    assert(buttonEl!.style.getPropertyValue('background') === '#3b82f6', '5. Button computed background is #3b82f6');
    assert(buttonEl!.style.getPropertyValue('color') === '#ffffff', '5. Button computed color is #ffffff');
    assert(buttonEl!.style.getPropertyValue('border-radius') === '8px', '5. Button computed border-radius is 8px');
    assert(buttonEl!.style.getPropertyValue('padding') === '12px 24px', '5. Button computed padding is 12px 24px');
    assert(buttonEl!.style.getPropertyValue('font-weight') === '600', '5. Button computed font-weight is 600');

    // Check Page and Container computed styles
    assert(pageEl!.style.getPropertyValue('background') === '#0f172a', '5. Page computed background is #0f172a');
    assert(containerEl!.style.getPropertyValue('padding') === '24px', '5. Container computed padding is 24px');
    assert(containerEl!.style.getPropertyValue('border-radius') === '16px', '5. Container computed border-radius is 16px');
    assert(containerEl!.style.getPropertyValue('background') === '#1e293b', '5. Container computed background is #1e293b');

    // Check 6: Clicking button changes displayed counter from 0 to 1
    assert(typeof buttonEl!.onclick === 'function', '6. Button has attached click handler');
    await buttonEl!.onclick!({ preventDefault: () => {} });

    assert(textElements[1].textContent.includes('1'), '6. Clicking button updates displayed counter from 0 to 1');
    assert(runtime.__manifest.state['counter'] === 1, '6. Reactive state reflects counter = 1');
    assert(stateNotifications.length > 0, '6. onState listener received state update event');

    // Check 7: Re-running example cleans previous interface without duplicate DOM nodes
    const initialChildCount = mountRoot.children.length;
    await runtime.startApp(mountRoot);
    assert(
      mountRoot.children.length === initialChildCount,
      '7. Re-running startApp refreshes cleanly without duplicating DOM elements'
    );
  } catch (err: any) {
    assert(false, `4-7. Runtime execution failure: ${err.message}`);
  }

  // 8. Check 8: Invalid Manifest syntax produces useful error diagnostic
  try {
    const invalidSource = `
      APP "BrokenApp"
      PAGE Broken
          BUTTON "Unclosed Button"
              STYLE
                  background: "#3b82f6"
              // missing END for STYLE
      END
    `;
    let threw = false;
    try {
      const tokens = new Lexer(invalidSource).tokenize();
      new Parser(tokens, invalidSource).parse();
    } catch (e: any) {
      threw = true;
      assert(e instanceof ManifestError, '8. Invalid syntax throws ManifestError');
      assert(e.line > 0, '8. Error contains line number');
    }
    assert(threw, '8. Invalid syntax was properly caught and rejected');
  } catch (err: any) {
    assert(false, `8. Invalid syntax check error: ${err.message}`);
  }

  // 9. Check 9: Runtime error reporting
  try {
    const { mockDocument, MockElement } = createMockDOM();
    const brokenMount: any = null; // null mount element without crash
    const compiler = new JSTargetCompiler();
    const res = compiler.compile(ir);
    const executable = res.outputCode!
      .replace('export const __manifest =', 'const __manifest =')
      .replace('export async function startApp', 'async function startApp') +
      '\nreturn { startApp };';
    const runtime = new Function('document', 'Element', executable)(mockDocument, MockElement);
    const instance = await runtime.startApp(brokenMount);
    assert(instance !== null, '9. Runtime handles null mountElement gracefully without throwing uncaught exception');
  } catch (err: any) {
    assert(false, `9. Runtime error reporting failure: ${err.message}`);
  }

  const total = passed + failed;
  console.log(`Styled Dashboard tests completed: ${passed}/${total} passed.\n`);
  return { passed, failed, total };
}

// When run directly from CLI
const isNodeCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_styled_dashboard_tests.ts'));

if (isNodeCLI) {
  runStyledDashboardTests()
    .then((summary) => {
      if (summary.failed > 0 && typeof process.exit === 'function') {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal styled test error:', err);
      if (typeof process.exit === 'function') {
        process.exit(1);
      }
    });
}
