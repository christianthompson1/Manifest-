import type {
  CompilationStatus,
  ExecutionStatus,
  VerificationStatus,
} from '../verification/result-model.ts';

export interface LiteSVMStepResult {
  stepName: string;
  instructionName: string;
  success: boolean;
  status: VerificationStatus;
  compilation: CompilationStatus;
  execution: ExecutionStatus;
  backend: 'litesvm' | 'static-analysis' | 'unavailable' | string;
  reason?: string;
  signature: string;
  computeUnitsUsed: number;
  logs: string[];
  error?: string;
  accountsState: Array<{
    address: string;
    role: string;
    lamports: string;
    balanceSol: number;
  }>;
}

export interface LiteSVMTestSuiteResult {
  success: boolean;
  status: VerificationStatus;
  execution: ExecutionStatus;
  backend: 'litesvm' | 'unavailable' | string;
  programName: string;
  programId: string;
  durationMs: number;
  stepsCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  unsupportedCount: number;
  notRunCount: number;
  totalComputeUnits: number;
  steps: LiteSVMStepResult[];
  idl: any;
  rustGenerated: boolean;
  error?: string;
}
