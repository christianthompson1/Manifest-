import { Lexer } from '../lexer/lexer.ts';
import { Parser } from '../parser/parser.ts';
import { Validator, ValidationResult } from '../validator/validator.ts';
import { IRBuilder } from '../ir/ir-builder.ts';
import { IRProgramNode } from '../ir/ir.ts';
import {
  TargetCompiler,
  CompilationResult,
  TargetCompilerOptions,
} from './compiler-interface.ts';
import { JSTargetCompiler } from './targets/js-target.ts';
import { SolanaTargetCompiler } from './targets/solana-target.ts';

export class CompilerRegistry {
  private static compilers: Map<string, TargetCompiler> = new Map();

  static {
    this.register(new JSTargetCompiler());
    this.register(new SolanaTargetCompiler());
  }

  public static register(compiler: TargetCompiler): void {
    this.compilers.set(compiler.targetName.toLowerCase(), compiler);
  }

  public static get(targetName: string): TargetCompiler | undefined {
    return this.compilers.get(targetName.toLowerCase());
  }

  public static has(targetName: string): boolean {
    return this.compilers.has(targetName.toLowerCase());
  }
}

export function inspectManifest(source: string): {
  tokens?: any[];
  ast?: any;
  program?: any;
  validation?: ValidationResult;
  diagnostics: any[];
} {
  const diagnostics: any[] = [];
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator();
    const validation = validator.validate(ast);
    return { tokens, ast, program: ast, validation, diagnostics };
  } catch (err: any) {
    diagnostics.push({
      line: err.line || 1,
      column: err.column || 1,
      message: err.message || String(err),
      severity: 'error',
      hint: err.hint,
      example: err.example,
    });
    return { diagnostics };
  }
}

export function generateManifestIR(source: string): IRProgramNode {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const builder = new IRBuilder();
  return builder.build(ast);
}

export async function compileManifest(
  source: string,
  targetName = 'js',
  options: TargetCompilerOptions = {}
): Promise<CompilationResult> {
  const compiler = CompilerRegistry.get(targetName);
  if (!compiler) {
    return {
      success: false,
      target: targetName,
      artifacts: [],
      diagnostics: [
        {
          severity: 'error',
          message: `Unsupported target '${targetName}'. Available targets: js, solana`,
          hint: 'Register a target compiler using CompilerRegistry.register()',
        },
      ],
    };
  }

  try {
    const ir = generateManifestIR(source);
    return await compiler.compile(ir, options);
  } catch (err: any) {
    return {
      success: false,
      target: targetName,
      artifacts: [],
      diagnostics: [
        {
          severity: 'error',
          message: err.message || String(err),
          line: err.line || 1,
          column: err.column || 1,
          hint: err.hint,
        },
      ],
    };
  }
}
