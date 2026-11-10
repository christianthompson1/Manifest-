# Manifest Backend & Systems Programming Specification (Phase 7)

Manifest provides a first-class backend programming model for developing HTTP services, microservices, and network APIs.

## Architecture & Program Model

1. **Explicit Capabilities**:
   - Backend networking requires the `net` capability:
     ```manifest
     module backend_service;
     requires net;
     ```
   - If an application attempts to bind an HTTP port or initiate outbound connections without `net` permission granted by the runtime host, execution immediately traps with `CapabilityDenied`.

2. **HTTP Server Engine (`ManifestHttpServer`)**:
   - Non-blocking asynchronous event loop.
   - Binds to configurable interface (`127.0.0.1`, `0.0.0.0`) and port.
   - Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`.
   - Dynamic parameter extraction: `/api/v1/users/:id` populates `req.params.id`.
   - Query string parser: `?page=1&limit=20` populates `req.query`.
   - Configurable request body limit (default 1MB) with `413 Payload Too Large` enforcement.
   - Request timeout guards (default 15s) with `504 Gateway Timeout` enforcement.
   - Automatic JSON response serialization and HTTP `400 Bad Request` handling for malformed request payloads.

3. **Composable Middleware Pipeline**:
   - Supports layered request/response interceptors:
     ```typescript
     server.use(async (req, next) => {
       console.log(`[Request] ${req.method} ${req.path}`);
       const res = await next();
       res.headers['X-Server-Version'] = '1.0';
       return res;
     });
     ```
   - Predictable left-to-right execution order with guaranteed unwinding.

4. **Graceful Shutdown**:
   - Drains active connections cleanly via `server.stop(gracePeriodMs)`.
   - Refuses new incoming requests with `503 Service Unavailable` while in-flight requests finish processing.

5. **Database Driver Architecture**:
   - `DatabaseDriver` interface defines contracts for connection pooling, parameterized query execution, transactions, and disconnection.
   - SQL queries are strictly parameterized to prevent injection vulnerabilities.
   - Unavailable drivers report status honestly without fabricating phantom database connections.
