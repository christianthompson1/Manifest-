/**
 * Canonical Honest Verification & Execution Result Model (Batch 1 Stage 3)
 *
 * Ensures every test runner, build provider, compiler verification suite,
 * Solana LiteSVM harness, and Studio UI view uses unambiguous status categories
 * and reconciles all aggregate totals (`passed + failed + skipped + unsupported + notRun === total`).
 */

export type VerificationStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'unsupported'
  | 'not-run';

export type CompilationStatus =
  | 'compiled'
  | 'generated-source-only'
  | 'not-attempted'
  | 'failed';

export type ExecutionStatus =
  | 'executed'
  | 'simulated'
  | 'analyzed-only'
  | 'not-run'
  | 'unavailable';

export interface VerificationEntry {
  id: string;
  name: string;
  status: VerificationStatus;
  compilation: CompilationStatus;
  execution: ExecutionStatus;
  backend: string;
  reason?: string;
  error?: string;
  output?: string;
}

export interface VerificationAggregateCounts {
  passed: number;
  failed: number;
  skipped: number;
  unsupported: number;
  notRun: number;
  total: number;
}

export function computeAggregateCounts(
  entries: ReadonlyArray<{ status: VerificationStatus }>
): VerificationAggregateCounts {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let unsupported = 0;
  let notRun = 0;

  for (const entry of entries) {
    switch (entry.status) {
      case 'passed':
        passed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'skipped':
        skipped++;
        break;
      case 'unsupported':
        unsupported++;
        break;
      case 'not-run':
        notRun++;
        break;
    }
  }

  return {
    passed,
    failed,
    skipped,
    unsupported,
    notRun,
    total: entries.length,
  };
}

export function reconcileCountsValid(counts: VerificationAggregateCounts): boolean {
  const fields = [
    counts.passed,
    counts.failed,
    counts.skipped,
    counts.unsupported,
    counts.notRun,
    counts.total,
  ];
  if (fields.some((n) => !Number.isInteger(n) || n < 0)) {
    return false;
  }
  return (
    counts.passed +
      counts.failed +
      counts.skipped +
      counts.unsupported +
      counts.notRun ===
    counts.total
  );
}

export interface TestRunResultItem {
  name: string;
  passed: boolean;
  status: VerificationStatus;
  error?: string;
}

export interface TestRunApiResponse {
  success: boolean;
  passed: number;
  failed: number;
  skipped?: number;
  unsupported?: number;
  notRun?: number;
  total: number;
  results?: Array<{
    name?: string;
    passed?: boolean;
    status?: string;
    error?: string;
    reason?: string;
  }>;
  logs?: string[];
  elapsedMs?: number;
  error?: string;
}

export interface ParsedTestRunState {
  ok: boolean;
  status: 'passed' | 'failed' | 'error';
  passed: number;
  failed: number;
  skipped: number;
  unsupported: number;
  notRun: number;
  total: number;
  results: TestRunResultItem[];
  logs: string[];
  elapsedMs?: number;
  error?: string;
}

function normalizeOptionalCount(val: unknown): number | null {
  if (val === undefined) return 0;
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
    return null;
  }
  return val;
}

function normalizeRequiredCount(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
    return null;
  }
  return val;
}

/**
 * Strictly parses an HTTP response from `/api/tests/run` without fabricating counts.
 * Rejects non-2xx statuses, malformed JSON, missing count fields, and unreconciled totals.
 */
export function parseTestRunApiResponse(
  resOk: boolean,
  httpStatus: number,
  rawBody: unknown
): ParsedTestRunState {
  let data: unknown = rawBody;
  if (typeof rawBody === 'string') {
    try {
      data = JSON.parse(rawBody);
    } catch {
      return {
        ok: false,
        status: 'error',
        passed: 0,
        failed: 0,
        skipped: 0,
        unsupported: 0,
        notRun: 0,
        total: 0,
        results: [],
        logs: [],
        error: `Malformed JSON response from test server (HTTP ${httpStatus})`,
      };
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      status: 'error',
      passed: 0,
      failed: 0,
      skipped: 0,
      unsupported: 0,
      notRun: 0,
      total: 0,
      results: [],
      logs: [],
      error: `Invalid response payload from test server (HTTP ${httpStatus})`,
    };
  }

  const obj = data as Record<string, unknown>;
  const logs = Array.isArray(obj.logs)
    ? obj.logs.map((entry) => String(entry))
    : [];

  if (!resOk) {
    const serverError =
      typeof obj.error === 'string' && obj.error.trim().length > 0
        ? obj.error
        : `Test runner endpoint returned HTTP ${httpStatus}`;
    return {
      ok: false,
      status: 'error',
      passed: 0,
      failed: 0,
      skipped: 0,
      unsupported: 0,
      notRun: 0,
      total: 0,
      results: [],
      logs,
      error: serverError,
    };
  }

  const passed = normalizeRequiredCount(obj.passed);
  const failed = normalizeRequiredCount(obj.failed);
  const total = normalizeRequiredCount(obj.total);
  const skipped = normalizeOptionalCount(obj.skipped);
  const unsupported = normalizeOptionalCount(obj.unsupported);
  const notRun = normalizeOptionalCount(obj.notRun);

  if (
    passed === null ||
    failed === null ||
    total === null ||
    skipped === null ||
    unsupported === null ||
    notRun === null
  ) {
    return {
      ok: false,
      status: 'error',
      passed: 0,
      failed: 0,
      skipped: 0,
      unsupported: 0,
      notRun: 0,
      total: 0,
      results: [],
      logs,
      error:
        'Invalid test suite payload: server response must include non-negative integer passed, failed, and total counts.',
    };
  }

  const counts: VerificationAggregateCounts = {
    passed,
    failed,
    skipped,
    unsupported,
    notRun,
    total,
  };

  if (!reconcileCountsValid(counts)) {
    return {
      ok: false,
      status: 'error',
      passed: 0,
      failed: 0,
      skipped: 0,
      unsupported: 0,
      notRun: 0,
      total: 0,
      results: [],
      logs,
      error: `Inconsistent test counts from server: passed (${passed}) + failed (${failed}) + skipped (${skipped}) + unsupported (${unsupported}) + notRun (${notRun}) !== total (${total}).`,
    };
  }

  const results: TestRunResultItem[] = Array.isArray(obj.results)
    ? obj.results.map((item, idx) => {
        const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        const rawStatus = typeof rec.status === 'string' ? rec.status.toUpperCase() : '';
        const isPassed =
          typeof rec.passed === 'boolean'
            ? rec.passed
            : rawStatus === 'PASSED' || rawStatus === 'PASS';
        const status: VerificationStatus =
          rawStatus === 'SKIPPED'
            ? 'skipped'
            : rawStatus === 'UNSUPPORTED'
            ? 'unsupported'
            : rawStatus === 'NOT-RUN'
            ? 'not-run'
            : isPassed
            ? 'passed'
            : 'failed';
        return {
          name:
            typeof rec.name === 'string' && rec.name.trim().length > 0
              ? rec.name
              : `Test ${idx + 1}`,
          passed: status === 'passed',
          status,
          error:
            typeof rec.error === 'string'
              ? rec.error
              : typeof rec.reason === 'string' && status === 'failed'
              ? rec.reason
              : undefined,
        };
      })
    : [];

  const elapsedMs = typeof obj.elapsedMs === 'number' ? obj.elapsedMs : undefined;
  const serverSuccess = obj.success === true;
  const allPassed = serverSuccess && failed === 0 && total > 0 && passed > 0;

  if (!allPassed) {
    const failReason =
      typeof obj.error === 'string' && obj.error.trim().length > 0
        ? obj.error
        : failed > 0
        ? `${failed} of ${total} tests failed`
        : total === 0
        ? 'No tests were executed'
        : 'Server reported test run failure';
    return {
      ok: false,
      status: 'failed',
      passed,
      failed,
      skipped,
      unsupported,
      notRun,
      total,
      results,
      logs,
      elapsedMs,
      error: failReason,
    };
  }

  return {
    ok: true,
    status: 'passed',
    passed,
    failed,
    skipped,
    unsupported,
    notRun,
    total,
    results,
    logs,
    elapsedMs,
  };
}

/**
 * Shared client helper to invoke `/api/tests/run` and parse the result honestly.
 */
export async function executeAndParseTestRun(
  fetchImpl: typeof fetch = fetch
): Promise<ParsedTestRunState> {
  try {
    const res = await fetchImpl('/api/tests/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const rawText = await res.text();
    return parseTestRunApiResponse(res.ok, res.status, rawText);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 'error',
      passed: 0,
      failed: 0,
      skipped: 0,
      unsupported: 0,
      notRun: 0,
      total: 0,
      results: [],
      logs: [],
      error: `Failed to reach /api/tests/run: ${message}`,
    };
  }
}
