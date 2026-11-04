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
import { isLegacyDomainManifestSource } from '../core/profile.ts';

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
    const parser = new Parser(tokens, source);
    const ast = parser.parse();
    const validator = new Validator(ast, source);
    const validation = validator.validate(ast);
    for (const issue of validation.issues) {
      diagnostics.push({
        line: issue.line || 1,
        column: issue.column || 1,
        message: issue.message,
        severity: issue.severity || 'error',
        source: 'validator',
        hint: issue.hint,
        example: issue.example,
      });
    }
    return { tokens, ast, program: ast, validation, diagnostics };
  } catch (err: any) {
    diagnostics.push({
      line: err.line || 1,
      column: err.column || 1,
      message: err.message || String(err),
      severity: 'error',
      source: err.phase || 'parser',
      hint: err.hint,
      example: err.example,
    });
    return { diagnostics };
  }
}

export function generateManifestIR(source: string): IRProgramNode {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, source);
  const ast = parser.parse();
  const builder = new IRBuilder();
  return builder.build(ast);
}

export function generateManifestIRFromAST(ast: any): IRProgramNode {
  const builder = new IRBuilder();
  return builder.build(ast);
}

export async function compileManifestIR(
  ir: IRProgramNode,
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
  return await compiler.compile(ir, options);
}

export async function compileManifest(
  source: string,
  targetName = 'js',
  options: TargetCompilerOptions = {}
): Promise<CompilationResult> {
  if (!isLegacyDomainManifestSource(source)) {
    const { compileManifestV1 } = await import('../pipeline.ts');
    const mappedTarget = targetName === 'js' ? 'web-js' : targetName;
    const v1 = await compileManifestV1(source, {
      target: mappedTarget,
      profile: options.profile,
      entryFile: options.entryFile,
      files: options.files,
      optimize: options.optimize,
    });
    return {
      success: v1.success,
      target: v1.target.id,
      outputCode: v1.jsCode || v1.rustCode || v1.watText || v1.disassembly || v1.irText,
      artifacts: v1.artifacts.map((a) => ({
        fileName: a.filename,
        content: a.isBinary && a.bytes ? Buffer.from(a.bytes).toString('base64') : a.text || '',
        fileType: a.isBinary ? 'binary' : a.filename.endsWith('.json') ? 'json' : 'text',
      })),
      diagnostics: v1.diagnostics.map((d) => ({
        severity: d.severity,
        message: d.message,
        line: d.line,
        column: d.column,
        hint: d.hint,
      })),
    };
  }

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
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, source);
    const ast = parser.parse();
    const validation = new Validator(ast, source).validate(ast);
    if (!validation.isValid) {
      return {
        success: false,
        target: targetName,
        artifacts: [],
        diagnostics: validation.issues.map((i) => ({
          severity: i.severity,
          message: i.message,
          line: i.line || 1,
          column: i.column || 1,
          hint: i.hint,
        })),
      };
    }

    const ir = generateManifestIRFromAST(ast);
    const compiled = await compiler.compile(ir, options);
    const warnings = validation.issues
      .filter((i) => i.severity !== 'error')
      .map((i) => ({
        severity: i.severity,
        message: i.message,
        line: i.line || 1,
        column: i.column || 1,
        hint: i.hint,
      }));
    return {
      ...compiled,
      diagnostics: [...warnings, ...(compiled.diagnostics || [])],
    };
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
