/**
 * Full-stack Express + Vite Server for Manifest Studio
 * Serves Manifest Studio on port 3000 with API endpoints and Vite dev/prod middleware.
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateManifestIR, compileManifest } from './manifest-core/src/index.ts';
import { LiteSVMRunner } from './manifest-core/src/solana/litesvm-runner.ts';
import { AnchorGenerator } from './manifest-core/src/solana/anchor-generator.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// Health / Status Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    app: 'Manifest Studio',
    version: '0.4.0',
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
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request: body must be a valid JSON-RPC object' },
      id: null,
    });
  }

  // Prevent giant payloads
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 256 * 1024) {
    return res.status(413).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Payload too large' },
      id: null,
    });
  }

  const network = (req.query.network as string) === 'mainnet' ? 'mainnet' : 'devnet';
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
    const upstreamRes = await fetch(targetUrl, {
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
      id: payload.id ?? null,
    });
  }
});

// Compile Endpoint
app.post('/api/compile', async (req: Request, res: Response) => {
  try {
    const { source, target = 'js' } = req.body;
    if (!source) {
      return res.status(400).json({ error: 'Source code is required' });
    }

    const result = await compileManifest(source, target);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

// Solana Anchor Generation & LiteSVM Verification Endpoint
app.post('/api/solana/verify', async (req: Request, res: Response) => {
  try {
    const { source } = req.body;
    if (!source) {
      return res.status(400).json({ error: 'Source code is required' });
    }

    const ir = generateManifestIR(source);
    if (!ir.solanaProgram) {
      return res.status(400).json({
        error: 'No Solana PROGRAM block found. Declare USE SOLANA and PROGRAM MyProgram.',
      });
    }

    const anchorArtifacts = AnchorGenerator.generate(ir.solanaProgram);
    const liteSVMReport = await LiteSVMRunner.runTestSuite(ir.solanaProgram);

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

// Full Language Test Suite Endpoint
app.post('/api/tests/run', async (_req: Request, res: Response) => {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;

  console.log = (...args) => {
    logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    origLog(...args);
  };
  console.error = (...args) => {
    logs.push('[ERR] ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    origError(...args);
  };

  try {
    const { runAllTests } = await import('./manifest-core/tests/run_tests.ts');
    const success = await runAllTests();
    res.json({ success, logs });
  } catch (err: any) {
    logs.push(`Error: ${err.message || String(err)}`);
    res.json({ success: false, logs });
  } finally {
    console.log = origLog;
    console.error = origError;
  }
});

async function startServer() {
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

startServer().catch((err) => {
  console.error('Failed to start Manifest Studio server:', err);
  process.exit(1);
});
