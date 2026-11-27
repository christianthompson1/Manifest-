/**
 * Full-stack Express + Vite Server for Manifest Studio
 * Serves Manifest Studio on port 3000 with API endpoints and Vite dev/prod middleware.
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  checkManifestSource,
  compileManifestV1,
  isSolanaProgramSource,
  parseSolanaProgramSource,
} from './manifest-core/src/index.ts';
import { LiteSVMRunner } from './manifest-core/src/solana/litesvm-runner.ts';
import { AnchorGenerator } from './manifest-core/src/solana/anchor-generator.ts';
import { validateSolanaRpcRequest } from './manifest-core/src/solana/rpc-policy.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// Compile Endpoint with strict target allowlist, payload size limits, and non-blocking timeout
const ALLOWED_COMPILE_TARGETS = new Set(['mvm', 'web-js', 'wasm', 'ir', 'check', 'solana-sbf']);

export interface ManifestServerOptions {
  fetchImpl?: typeof fetch;
}

export function createManifestServerApp(options: ManifestServerOptions = {}) {
  const app = express();
  const fetchImpl = options.fetchImpl ?? fetch;

  app.use(express.json({ limit: '10mb' }));

  // Health / Status Check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      app: 'Manifest Studio',
      version: '1.0.0',
      solanaEnabled: true,
      liteSVMReady: true,
    });
  });

  // Solana Status Endpoint (honest, server-side only status - never reveals credentials)
  app.get('/api/solana/status', (_req: Request, res: Response) => {
    const hasKey = Boolean(process.env.HELIUS_API_KEY && process.env.HELIUS_API_KEY.trim().length > 0);
    res.json({
      heliusConfigured: hasKey,
      defaultCluster: 'devnet',
      network: 'devnet',
    });
  });

  // Basic in-memory rate limiter for RPC proxy
  const rpcRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rpcRateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
      rpcRateLimitMap.set(ip, { count: 1, resetAt: now + 60000 });
      return true;
    }
    if (entry.count >= 120) {
      return false; // Limit exceeded
    }
    entry.count++;
    return true;
  }

  // Secure Solana JSON-RPC Proxy (never exposes HELIUS_API_KEY to browser)
  app.post('/api/solana/rpc', async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        jsonrpc: '2.0',
        error: { code: -32005, message: 'Rate limit exceeded. Please slow down.' },
        id: null,
      });
    }

    const payload = req.body;
    const network = (req.query.network as string) === 'mainnet' ? 'mainnet' : 'devnet';
    const validation = validateSolanaRpcRequest(payload, network);
    const requestId =
      payload && typeof payload === 'object' && !Array.isArray(payload) && 'id' in payload
        ? ((payload as { id?: unknown }).id ?? null)
        : null;

    if (!validation.allowed) {
      return res.status(validation.httpStatus).json({
        jsonrpc: '2.0',
        error: validation.error,
        id: requestId,
      });
    }

    // Prevent giant payloads
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > 256 * 1024) {
      return res.status(413).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Payload too large' },
        id: requestId,
      });
    }

    const heliusKey = process.env.HELIUS_API_KEY?.trim();

    let targetUrl: string;
    if (heliusKey) {
      targetUrl = network === 'mainnet'
        ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`
        : `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}`;
    } else {
      targetUrl = network === 'mainnet'
        ? 'https://api.mainnet-beta.solana.com'
        : 'https://api.devnet.solana.com';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const upstreamRes = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await upstreamRes.json();
      res.status(upstreamRes.status).json(data);
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      res.status(502).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: isTimeout ? 'RPC request timed out' : 'Failed to reach upstream Solana RPC',
        },
        id: requestId,
      });
    }
  });

  app.post('/api/compile', async (req: Request, res: Response) => {
    try {
      const { source, target = 'mvm', profile } = req.body;
      if (!source || typeof source !== 'string') {
        return res.status(400).json({ error: 'Source code string is required' });
      }
      if (source.length > 500_000) {
        return res.status(413).json({ error: 'Source code exceeds maximum allowed size (500 KB)' });
      }
      if (!ALLOWED_COMPILE_TARGETS.has(target)) {
        return res.status(400).json({
          error: `Target '${target}' is not permitted for remote server compilation. Allowed targets: ${Array.from(ALLOWED_COMPILE_TARGETS).join(', ')}. Native rustc compilation must run locally via Manifest CLI.`,
        });
      }

      const compilePromise = (async () => {
        if (target === 'check' || target === 'ir') {
          const checked = await checkManifestSource(source, {
            profile: profile === 'beginner' || profile === 'professional' ? profile : undefined,
          });
          return {
            success: checked.ok,
            target,
            resolvedProfile: checked.resolvedProfile,
            diagnostics: checked.diagnostics,
            irText: checked.irText,
            capabilityAudit: checked.capabilityAudit,
            astSummary: checked.astSummary,
            artifacts: [],
          };
        }

        const compiled = await compileManifestV1(source, {
          target,
          profile: profile === 'beginner' || profile === 'professional' ? profile : undefined,
          optimize: true,
        });

        return {
          success: compiled.success,
          target: compiled.target,
          resolvedProfile: compiled.resolvedProfile,
          diagnostics: compiled.diagnostics,
          irText: compiled.irText,
          disassembly: compiled.disassembly,
          capabilityAudit: compiled.capabilityAudit,
          jsCode: compiled.jsCode,
          rustCode: compiled.rustCode,
          idlJson: compiled.idlJson,
          artifacts: compiled.artifacts.map((art) => ({
            filename: art.filename,
            mimeType: art.mimeType,
            isBinary: art.isBinary,
            text: art.text,
            byteLength: art.bytes?.byteLength ?? 0,
          })),
        };
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Compilation timed out after 10000ms')), 10000)
      );

      const result = await Promise.race([compilePromise, timeoutPromise]);
      res.json(result);
    } catch (err: any) {
      const isTimeout = err.message?.includes('timed out');
      res.status(isTimeout ? 504 : 500).json({
        success: false,
        error: err.message || String(err),
      });
    }
  });

  // Solana Anchor Generation & LiteSVM Verification Endpoint
  app.post('/api/solana/verify', async (req: Request, res: Response) => {
    try {
      const { source } = req.body;
      if (!source || typeof source !== 'string') {
        return res.status(400).json({ error: 'Source code string is required' });
      }
      if (source.length > 500_000) {
        return res.status(413).json({ error: 'Source code exceeds maximum allowed size (500 KB)' });
      }

      if (!isSolanaProgramSource(source)) {
        return res.status(400).json({
          success: false,
          error: 'No standalone Solana PROGRAM block found. Declare `PROGRAM MyProgram ... END`.',
        });
      }

      const parsed = parseSolanaProgramSource(source);
      const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
      if (!parsed.program || errors.length > 0) {
        return res.status(400).json({
          success: false,
          error: errors.map((d) => d.message).join('; ') || 'Failed to parse Solana PROGRAM declaration.',
          diagnostics: parsed.diagnostics,
        });
      }

      const anchorArtifacts = AnchorGenerator.generate(parsed.program);
      const liteSVMReport = await LiteSVMRunner.runTestSuite(parsed.program);

      res.json({
        success: liteSVMReport.success,
        anchor: anchorArtifacts,
        litesvm: liteSVMReport,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || String(err),
      });
    }
  });

  // Full Language Test Suite Endpoint with isolated run state (no global console mutation)
  let isTestRunning = false;

  app.post('/api/tests/run', async (_req: Request, res: Response) => {
    if (isTestRunning) {
      return res.status(429).json({
        success: false,
        passed: 0,
        failed: 0,
        skipped: 0,
        unsupported: 0,
        notRun: 0,
        total: 0,
        results: [],
        error: 'A test suite run is already in progress. Please wait for it to complete.',
        logs: [],
      });
    }

    isTestRunning = true;
    const logs: string[] = [];

    try {
      logs.push('[TestRunner] Initializing isolated Stage 7 canonical v1 language test suite...');
      const { runAllTests } = await import('./manifest-core/tests/run_stage7_canonical_v1_tests.ts');

      const startTime = Date.now();
      const summary = await runAllTests();
      const elapsed = Date.now() - startTime;
      const success = summary.failed === 0 && summary.total > 0;
      const normalizedResults = (summary.results || []).map((item: any) => {
        const isPassed = item?.status === 'PASSED' || item?.passed === true;
        return {
          name: String(item?.name || 'Unnamed test'),
          passed: isPassed,
          status: isPassed ? 'passed' : 'failed',
          error: item?.reason || item?.error || item?.errorReceived || undefined,
        };
      });

      logs.push(
        `[TestRunner] Test suite finished in ${elapsed}ms: ${summary.passed}/${summary.total} passed, ${summary.failed} failed.`
      );
      for (const item of normalizedResults) {
        logs.push(`${item.passed ? '[PASS]' : '[FAIL]'} ${item.name}${item.error ? ` — ${item.error}` : ''}`);
      }

      res.json({
        success,
        passed: summary.passed,
        failed: summary.failed,
        skipped: 0,
        unsupported: 0,
        notRun: 0,
        total: summary.total,
        results: normalizedResults,
        logs,
        elapsedMs: elapsed,
      });
    } catch (err: any) {
      logs.push(`[TestRunner Error] ${err.message || String(err)}`);
      res.status(500).json({
        success: false,
        passed: 0,
        failed: 0,
        skipped: 0,
        unsupported: 0,
        notRun: 0,
        total: 0,
        results: [],
        logs,
        error: err.message || String(err),
      });
    } finally {
      isTestRunning = false;
    }
  });

  return app;
}

async function startServer() {
  const app = createManifestServerApp();

  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Manifest Studio server running at http://0.0.0.0:${PORT}`);
  });
}

const isMainEntry =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainEntry) {
  startServer().catch((err) => {
    console.error('Failed to start Manifest Studio server:', err);
    process.exit(1);
  });
}
