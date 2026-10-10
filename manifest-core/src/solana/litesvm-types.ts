export interface LiteSVMStepResult {
  stepName: string;
  instructionName: string;
  success: boolean;
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
  programName: string;
  programId: string;
  durationMs: number;
  stepsCount: number;
  passedCount: number;
  failedCount: number;
  totalComputeUnits: number;
  steps: LiteSVMStepResult[];
  idl: any;
  rustGenerated: boolean;
}
