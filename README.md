# Manifest Studio

Manifest Studio is a full-stack integrated development environment and compiler toolchain for the Manifest application language and Solana development.

## Security & RPC Configuration

### Protecting the Helius RPC Key
The application routes Solana RPC requests through a secure server-side proxy (`/api/solana/rpc`) on the Express backend. Client-side browser code never accesses or bundles secret API credentials.

- **Environment Variable:** `HELIUS_API_KEY` (server-side only, no `VITE_` prefix).
- **Public Fallback:** If `HELIUS_API_KEY` is unset or blank, the proxy automatically falls back to the public Solana cluster (`https://api.devnet.solana.com` or `https://api.mainnet-beta.solana.com`).
- **Configuration:**
  1. Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
  2. Add your server-side key:
     ```env
     HELIUS_API_KEY=your_helius_api_key_here
     ```
  3. Never prefix with `VITE_` as Vite bundles `VITE_` variables into client-side browser code.
  4. If a previous key was committed or exposed in a client bundle, rotate the key in your Helius dashboard immediately.

## Development & Testing

```bash
# Run type check
npm run lint

# Run Manifest test suite
npm run manifest:test

# Start full-stack development server (Express + Vite)
npm run dev

# Build client production bundle
npm run build
```
