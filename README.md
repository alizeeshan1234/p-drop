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

## Commands

pdrop has three modes:

### 1. Interactive Airdrop (recommended)

The easiest way to airdrop. Walks you through everything step by step.

```bash
npx tsx bin/cli.ts airdrop
```

You'll be asked:
- **Token mint address** — the token you want to airdrop
- **How to provide recipients:**
  - **Snapshot** — Auto-fetch all holders of a token on-chain
  - **CSV file** — Upload a CSV with wallet addresses and amounts
  - **Manual** — Enter addresses one by one

#### Snapshot mode

Automatically finds all holders of a source token and airdrops to them. Supports two distribution methods:

- **Equal** — Same amount to every holder
- **Pro-rata** — Proportional to their holdings (bigger holders get more)

```
Choose (1/2/3): 1
Source token mint: <TOKEN_WHOSE_HOLDERS_GET_THE_AIRDROP>
Found 200 holders

Distribution method:
  1. Equal    — Same amount to each holder
  2. Pro-rata — Proportional to their holdings
```

#### CSV mode

Provide a CSV file with wallet addresses and amounts:

```
Choose (1/2/3): 2
Path to CSV file: recipients.csv
```

CSV format:
```csv
wallet,amount
7jkBvmHpo5TeveiEfppU11X8MW3WjRxe3AxAvz5az9AM,1000000
ptokFjwyJtrwCa9Kgo9xoDS59V4QccBGEaRFnRPnSdP,2000000
```

The `amount` is in raw token units (e.g., with 6 decimals, `1000000` = 1 token).

#### Manual mode

Enter addresses one by one. Press enter with an empty wallet to finish.

```
Choose (1/2/3): 3
Wallet address: 7jkBvmHpo5T...
Amount (raw tokens): 1000000
Added. (1 total)

Wallet address: (press enter to finish)
```

### 2. CSV Direct

Skip the interactive prompts and run a CSV airdrop directly:

```bash
npx tsx bin/cli.ts csv --mint <MINT_ADDRESS> --csv recipients.csv --cluster devnet
```

### 3. Demo Mode

Run a live benchmark — creates random wallets and airdrops to them to showcase P-Token performance:

```bash
# Quick test
npx tsx bin/cli.ts demo --recipients 10 --cluster devnet

# Full benchmark
npx tsx bin/cli.ts demo --recipients 200 --cluster devnet
```

## All CLI Options

```
Usage: pdrop [command] [options]

Commands:
  airdrop            Interactive airdrop (snapshot, CSV, or manual)
  csv                Direct CSV airdrop
  demo               Live benchmark with random wallets

Common options:
  -c, --cluster      Solana cluster (default: "devnet")
  --rpc <url>        Custom RPC endpoint
  --keypair <path>   Path to keypair file

Demo options:
  -n, --recipients   Number of recipients (default: "20")

CSV options:
  -m, --mint         Token mint address (required)
  -f, --csv          Path to CSV file (required)
```

## Requirements

- Node.js 18+
- Solana CLI with a funded devnet wallet (`~/.config/solana/id.json`)
- ~2 SOL on devnet for account creation fees

If your wallet has < 2 SOL, the tool will attempt a devnet airdrop automatically.

## How It Works

1. **Collects recipients** via snapshot (on-chain scan), CSV file, or manual entry
2. **Derives Associated Token Accounts** for each recipient wallet
3. **Creates missing ATAs** automatically (batched, 5 per tx)
4. **Builds an Address Lookup Table** for large airdrops (>20 recipients), reducing tx size from 32 bytes to 1 byte per account
5. **Packs up to 60 transfers per versioned transaction** using the ALT
6. **Measures actual CU consumed** from on-chain transaction metadata
7. **Displays results** with comparison against pre-SIMD-0266 SPL Token costs

For small airdrops (≤20 recipients), regular transactions are used instead of ALTs for simplicity.

## Why P-Token is 98% cheaper

P-Token (built by [@0x_febo](https://x.com/0x_febo) and [@anza_xyz](https://x.com/anza_xyz)) replaces SPL Token with a Pinocchio-based implementation:

- **Zero-copy**: Direct byte offset reads instead of serialization/deserialization
- **No heap allocations**: Uses `no_std` Pinocchio framework
- **No logging**: SPL Token logs every instruction name (~103 CU overhead)
- **Transfer fast-path**: Detected at entrypoint, bypasses general dispatch

Approved via [SIMD-0266](https://github.com/solana-foundation/solana-improvement-documents/pull/266). Live on testnet and devnet. Mainnet target: April 2026.

## Project Structure

```
pdrop/
├── bin/cli.ts                    # CLI entrypoint (3 commands)
├── src/
│   ├── commands/
│   │   ├── airdrop.ts            # Interactive airdrop (snapshot/CSV/manual)
│   │   ├── csv.ts                # Direct CSV airdrop
│   │   └── demo.ts               # Benchmark demo
│   ├── core/
│   │   ├── alt-manager.ts        # Address Lookup Table lifecycle
│   │   ├── connection.ts         # RPC connection + retry logic
│   │   ├── ptoken-batch.ts       # ALT-packed transfer execution
│   │   ├── snapshot.ts           # On-chain token holder scanner
│   │   ├── spl-transfer.ts       # Standard SPL transfer builder
│   │   └── token-setup.ts        # Mint + account creation
│   ├── csv/
│   │   └── parser.ts             # CSV file parser
│   ├── display/
│   │   ├── banner.ts             # ASCII art header
│   │   ├── progress.ts           # Spinner utilities
│   │   └── results.ts            # Comparison table + bar charts
│   ├── constants.ts              # Program IDs + limits
│   └── types.ts                  # TypeScript interfaces
```

## Related

- [P-Token Benchmark](https://github.com/alizeeshan1234/p-token) — Full 25-instruction CU comparison
- [SIMD-0266](https://github.com/solana-foundation/solana-improvement-documents/pull/266) — The proposal that enables P-Token
- [Pinocchio](https://github.com/anza-xyz/pinocchio) — The zero-copy Solana framework P-Token is built on

## License

MIT
