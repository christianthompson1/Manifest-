/**
 * Manifest Compiler Core Engine
 * Coordinates Lexer -> Parser -> Validator -> IR Builder -> TargetCompiler
 */

import { Lexer } from '../lexer/lexer.ts';
import { Parser } from '../parser/parser.ts';
import { Validator } from '../validator/validator.ts';
import { ProgramNode } from '../ast/ast.ts';
import { IRProgramNode } from '../ir/ir.ts';
import { IRBuilder } from '../ir/ir-builder.ts';
import {
  ManifestCompiler,
  TargetCompiler,
  CompilationResult,
  TargetCompilerOptions,
} from './compiler-interface.ts';
import { JavaScriptTargetCompiler } from './targets/js-target.ts';
import { SolanaTargetCompiler } from './targets/solana-target.ts';

export class Compiler implements ManifestCompiler {
  private targets: Map<string, TargetCompiler> = new Map();
  private irBuilder: IRBuilder;

  constructor() {
    this.irBuilder = new IRBuilder();
    // Register default reference targets
    this.registerTarget(new JavaScriptTargetCompiler());
    // Alias 'javascript' and 'web' to 'js'
    const jsTarget = this.targets.get('js')!;
    this.targets.set('javascript', jsTarget);
    this.targets.set('web', jsTarget);

    // Register Solana Anchor target
    const solanaTarget = new SolanaTargetCompiler();
    this.registerTarget(solanaTarget);
    this.targets.set('anchor', solanaTarget);
  }

  public registerTarget(target: TargetCompiler): void {
    this.targets.set(target.targetName.toLowerCase(), target);
  }

  public getSupportedTargets(): string[] {
    return Array.from(new Set(this.targets.keys()));
  }

  public async compile(
    source: string,
    targetName: string = 'js',
    options?: TargetCompilerOptions
  ): Promise<CompilationResult> {
    const normTarget = targetName.toLowerCase();
    const targetCompiler = this.targets.get(normTarget);

    if (!targetCompiler) {
      return {
        success: false,
        target: targetName,
        artifacts: [],
        diagnostics: [
          {
            severity: 'error',
            message: `Unsupported target '${targetName}'. Supported targets are: ${this.getSupportedTargets().join(', ')}`,
            target: targetName,
            hint: 'Use target "js" or "javascript" to compile to modern JavaScript.',
          },
        ],
      };
    }

    try {
      // 1. Lexer
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();

      // 2. Parser
      const parser = new Parser(tokens, source);
      const ast = parser.parse();

      // 3. Validator
      const validator = new Validator(ast, source);
      const validation = validator.validate();
      if (!validation.isValid) {
        return {
          success: false,
          target: targetName,
          artifacts: [],
          diagnostics: validation.issues.map((issue) => ({
            severity: issue.severity,
            message: issue.message,
            line: issue.line,
            column: issue.column,
            hint: issue.hint,
          })),
        };
      }

      // 4. IR Builder
      const ir = this.irBuilder.build(ast);

      // 5. Target Compiler
      return await targetCompiler.compile(ir, options);
    } catch (err: any) {
      return {
        success: false,
        target: targetName,
        artifacts: [],
        diagnostics: [
          {
            severity: 'error',
            message: err.message || String(err),
            line: err.line,
            column: err.column,
          },
        ],
      };
    }
  }

  public async compileAST(
    ast: ProgramNode,
    targetName: string = 'js',
    options?: TargetCompilerOptions
  ): Promise<CompilationResult> {
    const normTarget = targetName.toLowerCase();
    const targetCompiler = this.targets.get(normTarget);

    if (!targetCompiler) {
      return {
        success: false,
        target: targetName,
        artifacts: [],
        diagnostics: [
          {
            severity: 'error',
            message: `Unsupported target '${targetName}'. Supported targets: ${this.getSupportedTargets().join(', ')}`,
          },
        ],
      };
    }

    const ir = this.irBuilder.build(ast);
    return await targetCompiler.compile(ir, options);
  }

  public async compileIR(
    ir: IRProgramNode,
    targetName: string = 'js',
    options?: TargetCompilerOptions
  ): Promise<CompilationResult> {
    const normTarget = targetName.toLowerCase();
    const targetCompiler = this.targets.get(normTarget);

    if (!targetCompiler) {
      return {
        success: false,
        target: targetName,
        artifacts: [],
        diagnostics: [
          {
            severity: 'error',
            message: `Unsupported target '${targetName}'. Supported targets: ${this.getSupportedTargets().join(', ')}`,
          },
        ],
      };
    }

    return await targetCompiler.compile(ir, options);
  }
}
