import { IRProgramNode } from '../ir/ir.ts';

export interface GeneratedArtifact {
  fileName: string;
  content: string;
  fileType: 'text' | 'json' | 'binary';
}

export interface CompilationDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
  target?: string;
  hint?: string;
}

export interface TargetCompilerOptions {
  minify?: boolean;
  sourceMaps?: boolean;
  targetVersion?: string;
  [key: string]: any;
}

export interface CompilationResult {
  success: boolean;
  target: string;
  outputCode?: string;
  artifacts: GeneratedArtifact[];
  diagnostics: CompilationDiagnostic[];
  ir?: IRProgramNode;
}

export interface TargetCompiler {
  readonly targetName: string;
  readonly fileExtension: string;
  compile(ir: IRProgramNode, options?: TargetCompilerOptions): Promise<CompilationResult> | CompilationResult;
}
