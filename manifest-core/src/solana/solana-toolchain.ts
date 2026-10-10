export interface ToolchainConfig {
  programName: string;
  solanaVersion: string;
  anchorVersion: string;
  rustVersion: string;
  enableFuzzing?: boolean;
  enableVerification?: boolean;
}

export class SolanaToolchainProvider {
  public static generateWorkflowYaml(config: ToolchainConfig): string {
    return `name: Solana Anchor Build & Verification

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:

env:
  SOLANA_VERSION: "${config.solanaVersion || '1.18.26'}"
  ANCHOR_VERSION: "${config.anchorVersion || '0.30.1'}"
  RUST_VERSION: "${config.rustVersion || '1.79.0'}"

jobs:
  anchor-build-and-test:
    name: Level 2: Anchor Build & Test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: \${{ env.RUST_VERSION }}
          components: clippy, rustfmt

      - name: Cache Solana & Anchor binaries
        uses: actions/cache@v4
        with:
          path: |
            ~/.local/share/solana
            ~/.cargo/bin/anchor
          key: solana-\${{ env.SOLANA_VERSION }}-anchor-\${{ env.ANCHOR_VERSION }}

      - name: Install Solana CLI
        run: |
          sh -c "$(curl -sSfL https://release.anza.xyz/v\${{ env.SOLANA_VERSION }}/install)"
          echo "$HOME/.local/share/solana/install/active_release/bin" >> $GITHUB_PATH

      - name: Install Anchor CLI
        run: |
          if ! command -v anchor &> /dev/null; then
            cargo install --git https://github.com/coral-xyz/anchor --tag v\${{ env.ANCHOR_VERSION }} anchor-cli --locked
          fi

      - name: Build Solana Program (${config.programName})
        run: anchor build

      - name: Run Integration Tests
        run: anchor test

      - name: Upload IDL and Binary Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: solana-program-artifacts
          path: |
            target/deploy/*.so
            target/idl/*.json
`;
  }
}
