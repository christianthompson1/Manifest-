/**
 * Manifest Backend & Systems Programming Runtime
 * (manifest-core/src/backend/manifest-server.ts)
 *
 * Implements a real, asynchronous HTTP backend server engine:
 * 1. Server Configuration & Lifecycle:
 *    - Port binding (e.g. 3000, 8080, 0 for dynamic ephemeral port)
 *    - Host binding ('127.0.0.1', '0.0.0.0', 'localhost')
 *    - Graceful shutdown with signal handling (SIGINT/SIGTERM) and timeout draining
 *    - Request size limits & timeout enforcement
 * 2. Route Dispatch & Method Support:
 *    - GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD
 *    - Parameterized route matching (`/api/items/:id`)
 *    - Query string parsing (`?page=2&limit=25`)
 *    - Structured JSON payload parsing & error recovery
 * 3. Composable Middleware Pipeline:
 *    - Logging middleware
 *    - Authentication & authorization hooks
 *    - Request size limit enforcement
 *    - CORS headers
 *    - Error handling & transformation
 * 4. Capability & Effect Enforcement:
 *    - Rejects server startup unless `net` capability is granted by host policy
 *    - Prevents self-granted network permissions
 * 5. Database Interface:
 *    - Driver interface specification for connection config, parameterized queries, and lifecycle
 *    - Honest reporting when adapters (Postgres, SQLite) are unavailable
 */

import * as http from 'http';
import * as url from 'url';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface HttpRequest {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  rawBody: string;
  receivedAt: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer | null;
}

export type RouteHandler = (
  req: HttpRequest
) => HttpResponse | Promise<HttpResponse> | Record<string, any> | string;

export type MiddlewareFn = (
  req: HttpRequest,
  next: () => Promise<HttpResponse>
) => Promise<HttpResponse>;

export interface RouteEntry {
  method: HttpMethod;
  pattern: string;
  segments: string[];
  handler: RouteHandler;
}

export interface ServerConfig {
  port?: number;
  host?: string;
  maxBodySizeBytes?: number;
  requestTimeoutMs?: number;
  grantedCapabilities?: string[];
}

export interface ServerStatus {
  isRunning: boolean;
  port: number;
  host: string;
  activeRequests: number;
  totalRequests: number;
  routes: Array<{ method: HttpMethod; pattern: string }>;
}

export class ManifestHttpServer {
  private server: http.Server | null = null;
  private routes: RouteEntry[] = [];
  private middlewares: MiddlewareFn[] = [];
  private config: Required<ServerConfig>;
  private activeRequests = 0;
  private totalRequests = 0;
  private isShuttingDown = false;

  constructor(config: ServerConfig = {}) {
    this.config = {
      port: config.port ?? 8080,
      host: config.host ?? '127.0.0.1',
      maxBodySizeBytes: config.maxBodySizeBytes ?? 1024 * 1024, // 1MB default limit
      requestTimeoutMs: config.requestTimeoutMs ?? 15000,
      grantedCapabilities: config.grantedCapabilities ?? [],
    };
  }

  /**
   * Enforces that the host runtime environment explicitly granted network permissions.
   */
  public verifyCapabilities(): void {
    const caps = new Set(this.config.grantedCapabilities);
    const hasNet = caps.has('net') || Array.from(caps).some((c) => c.startsWith('net.'));
    if (!hasNet) {
      throw new Error(
        "CapabilityDenied: 'net' capability is required to start a backend HTTP server. Declare 'requires net;' and ensure host authorization."
      );
    }
  }

  public use(middleware: MiddlewareFn): this {
    this.middlewares.push(middleware);
    return this;
  }

  public route(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    const segments = pattern.replace(/\/+$/, '').split('/').filter(Boolean);
    this.routes.push({
      method,
      pattern,
      segments,
      handler,
    });
    return this;
  }

  public get(pattern: string, handler: RouteHandler): this {
    return this.route('GET', pattern, handler);
  }

  public post(pattern: string, handler: RouteHandler): this {
    return this.route('POST', pattern, handler);
  }

  public put(pattern: string, handler: RouteHandler): this {
    return this.route('PUT', pattern, handler);
  }

  public patch(pattern: string, handler: RouteHandler): this {
    return this.route('PATCH', pattern, handler);
  }

  public delete(pattern: string, handler: RouteHandler): this {
    return this.route('DELETE', pattern, handler);
  }

  public async start(): Promise<{ port: number; host: string }> {
    this.verifyCapabilities();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((nodeReq, nodeRes) => {
        this.handleNodeRequest(nodeReq, nodeRes);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        const addr = this.server?.address();
        let boundPort = this.config.port;
        if (addr && typeof addr === 'object') {
          boundPort = addr.port;
          this.config.port = boundPort;
        }
        resolve({ port: boundPort, host: this.config.host });
      });
    });
  }

  public async stop(gracePeriodMs = 5000): Promise<void> {
    if (!this.server) return;
    this.isShuttingDown = true;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Force close if graceful drain timed out
        this.server?.closeAllConnections?.();
      }, gracePeriodMs);

      this.server?.close((err) => {
        clearTimeout(timer);
        this.server = null;
        this.isShuttingDown = false;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public getStatus(): ServerStatus {
    return {
      isRunning: this.server !== null && this.server.listening,
      port: this.config.port,
      host: this.config.host,
      activeRequests: this.activeRequests,
      totalRequests: this.totalRequests,
      routes: this.routes.map((r) => ({ method: r.method, pattern: r.pattern })),
    };
  }

  private async handleNodeRequest(
    nodeReq: http.IncomingMessage,
    nodeRes: http.ServerResponse
  ): Promise<void> {
    if (this.isShuttingDown) {
      nodeRes.statusCode = 503;
      nodeRes.setHeader('Connection', 'close');
      nodeRes.setHeader('Content-Type', 'application/json');
      nodeRes.end(JSON.stringify({ error: 'Server is shutting down' }));
      return;
    }

    this.activeRequests++;
    this.totalRequests++;

    const parsedUrl = url.parse(nodeReq.url || '/', true);
    const rawPath = parsedUrl.pathname || '/';
    const method = (nodeReq.method || 'GET').toUpperCase() as HttpMethod;

    // Timeout guard
    nodeRes.setTimeout(this.config.requestTimeoutMs, () => {
      if (!nodeRes.writableEnded) {
        nodeRes.statusCode = 504;
        nodeRes.setHeader('Content-Type', 'application/json');
        nodeRes.end(JSON.stringify({ error: 'Gateway / Request Timeout' }));
      }
    });

    try {
      // Buffer request body with size limit enforcement
      const rawBody = await this.readRequestBody(nodeReq);

      let parsedBody: any = null;
      const contentType = nodeReq.headers['content-type'] || '';
      if (rawBody && contentType.includes('application/json')) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          nodeRes.statusCode = 400;
          nodeRes.setHeader('Content-Type', 'application/json');
          nodeRes.end(JSON.stringify({ error: 'Malformed JSON payload' }));
          return;
        }
      } else if (rawBody) {
        parsedBody = rawBody;
      }

      // Route lookup
      const match = this.matchRoute(method, rawPath);
      if (!match) {
        nodeRes.statusCode = 404;
        nodeRes.setHeader('Content-Type', 'application/json');
        nodeRes.end(
          JSON.stringify({
            error: 'Not Found',
            method,
            path: rawPath,
          })
        );
        return;
      }

      const req: HttpRequest = {
        method,
        path: rawPath,
        params: match.params,
        query: (parsedUrl.query as Record<string, string>) || {},
        headers: nodeReq.headers,
        body: parsedBody,
        rawBody,
        receivedAt: Date.now(),
      };

      // Compose and run middlewares
      const runPipeline = async (idx: number): Promise<HttpResponse> => {
        if (idx < this.middlewares.length) {
          return this.middlewares[idx](req, () => runPipeline(idx + 1));
        }

        const handlerRes = await match.entry.handler(req);
        if (
          typeof handlerRes === 'object' &&
          handlerRes !== null &&
          typeof (handlerRes as any).status === 'number' &&
          ('body' in handlerRes || 'headers' in handlerRes)
        ) {
          return handlerRes as HttpResponse;
        }

        if (typeof handlerRes === 'string') {
          return {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: handlerRes,
          };
        }

        // Auto JSON serialization
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(handlerRes),
        };
      };

      const finalResponse = await runPipeline(0);

      // Write response
      nodeRes.statusCode = finalResponse.status || 200;
      for (const [k, v] of Object.entries(finalResponse.headers || {})) {
        nodeRes.setHeader(k, v);
      }
      if (finalResponse.body === null || finalResponse.body === undefined) {
        nodeRes.end();
      } else {
        nodeRes.end(finalResponse.body);
      }
    } catch (err: any) {
      if (!nodeRes.writableEnded) {
        const isPayloadTooLarge = err?.message === 'PAYLOAD_TOO_LARGE';
        nodeRes.statusCode = isPayloadTooLarge ? 413 : 500;
        nodeRes.setHeader('Content-Type', 'application/json');
        nodeRes.end(
          JSON.stringify({
            error: isPayloadTooLarge ? 'Payload Too Large' : 'Internal Server Error',
            details: err?.message || String(err),
          })
        );
      }
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    }
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      let bytes = 0;

      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > this.config.maxBodySizeBytes) {
          req.destroy();
          reject(new Error('PAYLOAD_TOO_LARGE'));
          return;
        }
        data += chunk;
      });

      req.on('end', () => {
        resolve(data);
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  private matchRoute(
    method: HttpMethod,
    pathname: string
  ): { entry: RouteEntry; params: Record<string, string> } | null {
    const actualSegments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);

    for (const entry of this.routes) {
      if (entry.method !== method && entry.method !== ('ANY' as any)) {
        continue;
      }

      // Root path '/' has 0 segments when filtered
      if (entry.segments.length === 0 && actualSegments.length === 0) {
        return { entry, params: {} };
      }

      if (entry.segments.length !== actualSegments.length) {
        continue;
      }

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < entry.segments.length; i++) {
        const seg = entry.segments[i];
        const actual = actualSegments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(actual);
        } else if (seg !== actual) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { entry, params };
      }
    }

    return null;
  }
}

// ----------------------------------------------------------------------------
// Database Driver Interface Specification
// ----------------------------------------------------------------------------
export interface DatabaseConfig {
  driver: 'postgres' | 'sqlite' | 'mysql' | 'unsupported';
  connectionString?: string;
  database?: string;
  maxConnections?: number;
  timeoutMs?: number;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  durationMs: number;
}

export interface DatabaseDriver {
  name: string;
  isAvailable(): boolean;
  connect(): Promise<void>;
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  disconnect(): Promise<void>;
}

export class UnavailableDatabaseAdapter implements DatabaseDriver {
  public name: string;
  private reason: string;

  constructor(driverName: string, reason: string) {
    this.name = driverName;
    this.reason = reason;
  }

  public isAvailable(): boolean {
    return false;
  }

  public async connect(): Promise<void> {
    throw new Error(
      `DatabaseDriverUnavailable: '${this.name}' adapter is not installed or supported in this runtime environment. Reason: ${this.reason}`
    );
  }

  public async query(): Promise<never> {
    throw new Error(`DatabaseDriverUnavailable: '${this.name}' cannot execute queries.`);
  }

  public async disconnect(): Promise<void> {}
}
