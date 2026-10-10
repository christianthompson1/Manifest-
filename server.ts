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
