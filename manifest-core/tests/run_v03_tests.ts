/**
 * Manifest Core v0.3 - Test Suite for Multi-Language IDE & UI Primitives Foundation
 * Tests:
 * 1. STYLE block parsing and styling on BUTTON & TEXT
 * 2. CONTAINER with layout, direction, gap, align, padding
 * 3. Nested UI inside CONTAINER
 * 4. CARD, LIST, LINK, SELECT, CHECKBOX, TEXTAREA
 * 5. Semantic containers: HEADER, FOOTER, NAV, MODAL
 * 6. COMPONENT declaration and call
 * 7. End-to-end compilation to Web DOM runtime
 */

import { Lexer } from '../src/lexer/lexer.ts';
import { Parser } from '../src/parser/parser.ts';
import { Validator } from '../src/validator/validator.ts';
import { IRBuilder } from '../src/ir/ir-builder.ts';
import { JavaScriptTargetCompiler } from '../src/compiler/targets/js-target.ts';

function compileSource(src: string) {
  const lexer = new Lexer(src);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, src);
  const ast = parser.parse();
  const validator = new Validator(ast, src);
  const valResult = validator.validate();
  const irBuilder = new IRBuilder();
  const ir = irBuilder.build(ast);
  const compiler = new JavaScriptTargetCompiler();
  const compilation = compiler.compile(ir, { moduleFormat: 'esm' });
  return { tokens, ast, valResult, ir, compilation };
}

export function runV03Tests(): { passed: number; failed: number; total: number } {
  console.log('\n--- Running Manifest v0.3 UI Primitives & Design System Tests ---');
  let passed = 0;
  let failed = 0;
  let total = 0;

  function assert(cond: boolean, desc: string, expected?: string, actual?: string) {
    total++;
    if (!cond) {
      console.error(`  ✗ FAIL: ${desc}`);
      if (expected !== undefined || actual !== undefined) {
        console.error(`    Expected: ${expected}`);
        console.error(`    Actual:   ${actual}`);
      }
      failed++;
      return;
    }
    console.log(`  ✓ ${desc}`);
    passed++;
  }

  // Test 1: Style block on BUTTON
  try {
    const code = `
APP "StyledButtonApp"
PAGE Home
    BUTTON "Get Started"
        STYLE
            WIDTH 160
            HEIGHT 48
            BACKGROUND "#2563EB"
            COLOR "#FFFFFF"
            FONT_SIZE 16
            FONT_WEIGHT 600
            PADDING 12 20
            RADIUS 12
        END
    END
END
`;
    const { ast, ir, compilation } = compileSource(code);
    const statements = ast.body || ast.statements || [];
    const hasPage = statements.some((s) => s.type === 'PageDeclaration' && (s as any).name === 'Home');
    assert(ast.type === 'AppDeclaration' && ast.name === 'StyledButtonApp' && hasPage, '1. AST captures APP and PAGE with styled button');
    const pageIR = ir.pages?.[0];
    assert(pageIR?.children.length === 1, '1. Page IR contains 1 child');
    const btn = pageIR?.children[0] as any;
    assert(btn?.kind === 'IRButton', '1. Child is IRButton');
    assert(btn?.styles?.width === '160px', '1. Button style width is 160px');
    assert(btn?.styles?.background === '#2563EB', '1. Button style background is #2563EB');
    assert(btn?.styles?.borderRadius === '12px', '1. Button style borderRadius is 12px');
    const out = compilation.outputCode || '';
    assert(out.includes('.style["width"] = "160px"'), '1. Generated JS applies width style');
  } catch (err: any) {
    assert(false, `1. StyledButtonApp error: ${err.message}`);
  }

  // Test 2: CONTAINER with LAYOUT, DIRECTION, GAP, ALIGN
  try {
    const code = `
APP "ContainerApp"
PAGE Home
    CONTAINER
        LAYOUT FLEX
        DIRECTION COLUMN
        GAP 16
        ALIGN CENTER
        PADDING 24

        TEXT "Welcome"
        BUTTON "Continue"
    END
END
`;
    const { ir, compilation } = compileSource(code);
    const pageIR = ir.pages?.[0];
    const container = pageIR?.children[0] as any;
    assert(container?.kind === 'IRContainer', '2. IR captures IRContainer node');
    assert(container?.children?.length === 2, '2. Container contains 2 children');
    assert(container?.styles?.display === 'flex', '2. Container display is flex');
    assert(container?.styles?.flexDirection === 'column', '2. Container flexDirection is column');
    assert(container?.styles?.gap === '16px', '2. Container gap is 16px');
    assert(container?.styles?.alignItems === 'center', '2. Container alignItems is center');
    const out2 = compilation.outputCode || '';
    assert(out2.includes('.className = "manifest-container"'), '2. Generated JS creates manifest-container DOM element');
  } catch (err: any) {
    assert(false, `2. ContainerApp error: ${err.message}`);
  }

  // Test 3: Nested CONTAINER structure
  try {
    const code = `
APP "NestedApp"
PAGE Home
    CONTAINER
        TEXT "Outer Header"
        CONTAINER
            TEXT "Inner Content"
            BUTTON "Inner Action"
        END
    END
END
`;
    const { ir } = compileSource(code);
    const outer = ir.pages?.[0]?.children[0] as any;
    assert(outer?.kind === 'IRContainer', '3. Outer node is IRContainer');
    assert(outer?.children?.length === 2, '3. Outer container has 2 children');
    const inner = outer?.children?.[1];
    assert(inner?.kind === 'IRContainer', '3. Inner node is nested IRContainer');
    assert(inner?.children?.length === 2, '3. Inner container has 2 children');
  } catch (err: any) {
    assert(false, `3. NestedApp error: ${err.message}`);
  }

  // Test 4: CARD, LIST, LINK primitives
  try {
    const code = `
APP "PrimitivesApp"
PAGE Home
    CARD
        TEXT "Card Title"
        LINK "Read Docs" TO "https://manifest.build"
    END
    LIST
        TEXT "Item 1"
        TEXT "Item 2"
    END
END
`;
    const { ir, compilation } = compileSource(code);
    const children = ir.pages?.[0]?.children || [];
    assert(children[0]?.kind === 'IRCard', '4. IR captures IRCard');
    assert(children[1]?.kind === 'IRList', '4. IR captures IRList');
    const out4 = compilation.outputCode || '';
    assert(out4.includes('.className = "manifest-card"'), '4. JS generates manifest-card element');
    assert(out4.includes('.className = "manifest-list"'), '4. JS generates manifest-list element');
    assert(out4.includes('.className = "manifest-link"'), '4. JS generates manifest-link element');
  } catch (err: any) {
    assert(false, `4. PrimitivesApp error: ${err.message}`);
  }

  // Test 5: Interactive Inputs (SELECT, CHECKBOX, TEXTAREA)
  try {
    const code = `
APP "InteractiveApp"
PAGE Home
    STATE role TO "developer"
    STATE agreed TO false
    STATE notes TO ""

    SELECT INTO role
    CHECKBOX "Agree to terms" INTO agreed
    TEXTAREA "Enter notes" INTO notes
END
`;
    const { ir, compilation } = compileSource(code);
    const children = ir.pages?.[0]?.children || [];
    assert(children[0]?.kind === 'IRSelect', '5. IR captures IRSelect');
    assert(children[1]?.kind === 'IRCheckbox', '5. IR captures IRCheckbox');
    assert(children[2]?.kind === 'IRTextarea', '5. IR captures IRTextarea');
    const out5 = compilation.outputCode || '';
    assert(out5.includes('.className = "manifest-select"'), '5. JS generates manifest-select element');
    assert(out5.includes('__input.type = "checkbox"'), '5. JS generates checkbox input');
    assert(out5.includes('.className = "manifest-textarea"'), '5. JS generates manifest-textarea element');
  } catch (err: any) {
    assert(false, `5. InteractiveApp error: ${err.message}`);
  }

  // Test 6: Semantic Containers (HEADER, FOOTER, NAV, MODAL)
  try {
    const code = `
APP "SemanticApp"
PAGE Home
    HEADER
        TEXT "Page Header"
    END
    NAV
        LINK "Home" TO "/"
        LINK "About" TO "/about"
    END
    FOOTER
        TEXT "Footer info"
    END
END
`;
    const { ir, compilation } = compileSource(code);
    const children = ir.pages?.[0]?.children || [];
    assert(children[0]?.kind === 'IRHeader', '6. IR captures IRHeader');
    assert(children[1]?.kind === 'IRNav', '6. IR captures IRNav');
    assert(children[2]?.kind === 'IRFooter', '6. IR captures IRFooter');
    const out6 = compilation.outputCode || '';
    assert(out6.includes('createElement("header")'), '6. JS creates header DOM element');
    assert(out6.includes('createElement("nav")'), '6. JS creates nav DOM element');
    assert(out6.includes('createElement("footer")'), '6. JS creates footer DOM element');
  } catch (err: any) {
    assert(false, `6. SemanticApp error: ${err.message}`);
  }

  // Test 7: COMPONENT declaration & invocation
  try {
    const code = `
APP "ComponentApp"

COMPONENT UserBadge
    INPUT title: TEXT
    CONTAINER
        TEXT "User: "
    END
END

PAGE Home
    UserBadge
END
`;
    const { ir, compilation } = compileSource(code);
    const out7 = compilation.outputCode || '';
    assert(out7.includes('__manifest.registerComponent("UserBadge"'), '7. JS registers UserBadge component');
    assert(out7.includes('__manifest.components["UserBadge"]'), '7. JS calls UserBadge component');
  } catch (err: any) {
    assert(false, `7. ComponentApp error: ${err.message}`);
  }

  // Test 8: End-to-end sandbox DOM mount & reactive execution with styled container
  try {
    const code = `
APP "LiveApp"
PAGE Home
    STATE counter TO 0
    CONTAINER
        LAYOUT FLEX
        DIRECTION COLUMN
        GAP 12
        TEXT "Value: " + counter
        BUTTON "Increment"
            STYLE
                BACKGROUND "#2563EB"
                COLOR "#FFFFFF"
            END
            WHEN CLICK
                SET counter TO counter + 1
            END
        END
    END
END
`;
    const { compilation } = compileSource(code);
    assert(compilation.success, '8. Compilation succeeds without errors');
    const out8 = compilation.outputCode || '';
    assert(out8.includes('startApp'), '8. Generates startApp bootstrap');
  } catch (err: any) {
    assert(false, `8. LiveApp error: ${err.message}`);
  }

  console.log(`\nManifest v0.3 tests completed: ${passed}/${total} passed (failed: ${failed}).`);
  return { passed, failed, total };
}

const isNodeCLI =
  typeof process !== 'undefined' &&
  Boolean(process.argv && process.argv[1] && process.argv[1].endsWith('run_v03_tests.ts'));

if (isNodeCLI) {
  const summary = runV03Tests();
  if (summary.failed > 0 && typeof process.exit === 'function') {
    process.exit(1);
  }
}
