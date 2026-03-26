# pdrop

Airdrop tool powered by P-Token (SIMD-0266) — **98% cheaper** than SPL Token.

```
╔══════════════════════════════════════════════════════════════════╗
║              SPL TOKEN vs P-TOKEN AIRDROP                       ║
║              200  recipients on devnet                          ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   Metric           SPL Token       P-Token       Savings        ║
║   ─────────────    ──────────      ─────────     ────────       ║
║   Total CU         929,000        15,200        98.4%           ║
║   Transactions     10             4             60.0%           ║
║   CU/transfer      4,645          76            98.4%           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

## What is this?

pdrop uses **P-Token (SIMD-0266)** — the Pinocchio-based replacement for SPL Token — to airdrop tokens at a fraction of the compute cost. On devnet/testnet where SIMD-0266 is active, every token transfer uses ~76 CU instead of ~4,645 CU.

It packs up to **60 transfers per transaction** using Address Lookup Tables (ALTs) with versioned transactions.

## Quick Start

```bash
git clone https://github.com/alizeeshan1234/pdrop.git
cd pdrop
npm install
```

### Run a demo (10 recipients)

```bash
npx tsx bin/cli.ts demo --recipients 10 --cluster devnet
```

### Run a full benchmark (200 recipients)

```bash
npx tsx bin/cli.ts demo --recipients 200 --cluster devnet
```

### Custom RPC endpoint

```bash
npx tsx bin/cli.ts demo --recipients 200 --cluster devnet --rpc https://your-rpc.com
```

### Custom keypair

```bash
npx tsx bin/cli.ts demo --recipients 50 --cluster devnet --keypair ~/my-keypair.json
```

## Requirements

- Node.js 18+
- Solana CLI with a funded devnet wallet (`~/.config/solana/id.json`)
- ~2 SOL on devnet for account creation fees

If your wallet has < 2 SOL, the tool will attempt a devnet airdrop automatically.

## How It Works

1. **Creates a token mint** and source account on devnet
2. **Generates N random recipient wallets** with token accounts
3. **Builds an Address Lookup Table** with all addresses (reduces tx size from 32 bytes to 1 byte per account)
4. **Packs 60 transfers per versioned transaction** using the ALT
5. **Measures actual CU consumed** from on-chain transaction metadata
6. **Compares against theoretical SPL Token costs** (pre-SIMD-0266: 4,645 CU per transfer)

## Why P-Token is 98% cheaper

P-Token (built by [@0x_febo](https://x.com/0x_febo) and [@anza_xyz](https://x.com/anza_xyz)) replaces SPL Token with a Pinocchio-based implementation:

- **Zero-copy**: Direct byte offset reads instead of serialization/deserialization
- **No heap allocations**: Uses `no_std` Pinocchio framework
- **No logging**: SPL Token logs every instruction name (~103 CU overhead)
- **Transfer fast-path**: Detected at entrypoint, bypasses general dispatch

Approved via [SIMD-0266](https://github.com/solana-foundation/solana-improvement-documents/pull/266). Live on testnet and devnet. Mainnet target: April 2026.

## CLI Options

```
Usage: pdrop demo [options]

Run a live SPL Token vs P-Token airdrop comparison

Options:
  -n, --recipients <number>  Number of recipients (default: "20")
  -c, --cluster <cluster>    Solana cluster (default: "devnet")
  --rpc <url>                Custom RPC endpoint
  --keypair <path>           Path to keypair file
  -h, --help                 display help for command
```

## Project Structure

```
pdrop/
├── bin/cli.ts                 # CLI entrypoint
├── src/
│   ├── commands/demo.ts       # Demo mode orchestrator
│   ├── core/
│   │   ├── alt-manager.ts     # Address Lookup Table lifecycle
│   │   ├── connection.ts      # RPC connection + retry logic
│   │   ├── ptoken-batch.ts    # ALT-packed transfer execution
│   │   ├── spl-transfer.ts    # Standard SPL transfer (unused on SIMD-0266 networks)
│   │   └── token-setup.ts     # Mint + account creation
│   ├── display/
│   │   ├── banner.ts          # ASCII art header
│   │   ├── progress.ts        # Spinner utilities
│   │   └── results.ts         # Comparison table + bar charts
│   ├── constants.ts           # Program IDs + limits
│   └── types.ts               # TypeScript interfaces
```

## Related

- [P-Token Benchmark](https://github.com/alizeeshan1234/p-token) — Full 25-instruction CU comparison
- [SIMD-0266](https://github.com/solana-foundation/solana-improvement-documents/pull/266) — The proposal that enables P-Token
- [Pinocchio](https://github.com/anza-xyz/pinocchio) — The zero-copy Solana framework P-Token is built on

## License

MIT
