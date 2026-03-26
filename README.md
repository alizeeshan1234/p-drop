# pdrop

Airdrop & batch send tool powered by P-Token (SIMD-0266) — **98% cheaper** than SPL Token.

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

---

## Table of Contents

- [What is pdrop?](#what-is-pdrop)
- [Installation](#installation)
- [Commands](#commands)
  - [airdrop](#1-airdrop--interactive)
  - [csv](#2-csv--direct-csv-airdrop)
  - [send](#3-send--inline-batch-send)
  - [send-sol](#4-send-sol--batch-send-sol)
  - [multi-send](#5-multi-send--multi-token-batch)
  - [estimate](#6-estimate--cost-calculator)
  - [demo](#7-demo--live-benchmark)
- [Global Options](#global-options)
- [Safety Features](#safety-features)
  - [Dry Run](#dry-run)
  - [Confirmation Prompt](#confirmation-prompt)
  - [Max Cost Limit](#max-cost-limit)
  - [Balance Check](#balance-check)
  - [Resume Failed Airdrops](#resume-failed-airdrops)
- [Output & Receipts](#output--receipts)
  - [JSON Receipt](#json-receipt)
  - [CSV Receipt](#csv-receipt)
  - [Webhook Notification](#webhook-notification)
- [File Formats](#file-formats)
  - [CSV Format](#csv-format)
  - [JSON Format (multi-send)](#json-format-multi-send)
- [How It Works](#how-it-works)
- [Why P-Token is 98% Cheaper](#why-p-token-is-98-cheaper)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Related](#related)
- [License](#license)

---

## What is pdrop?

pdrop uses **P-Token (SIMD-0266)** — the Pinocchio-based replacement for SPL Token — to airdrop and batch send tokens at a fraction of the compute cost. On devnet/testnet where SIMD-0266 is active, every token transfer uses **~76 CU instead of ~4,645 CU**.

It packs up to **60 transfers per transaction** using Address Lookup Tables (ALTs) with versioned transactions.

**What you can do with pdrop:**

| Command | What it does |
|---------|-------------|
| `airdrop` | Interactive airdrop with snapshot, CSV, or manual input |
| `csv` | Direct CSV-based airdrop |
| `send` | Inline batch send tokens from CLI args |
| `send-sol` | Batch send SOL to multiple wallets |
| `multi-send` | Send different tokens to different wallets |
| `estimate` | Compare P-Token vs SPL Token costs |
| `demo` | Live benchmark with random wallets |

---

## Installation

```bash
git clone https://github.com/alizeeshan1234/pdrop.git
cd pdrop
npm install
```

Or install globally via npm:

```bash
npm install -g pdrop-cli
```

After global install, use `pdrop` directly instead of `npx tsx bin/cli.ts`.

---

## Commands

### 1. `airdrop` — Interactive

The easiest way to get started. Walks you through everything step by step.

```bash
npx tsx bin/cli.ts airdrop
npx tsx bin/cli.ts airdrop --cluster devnet
npx tsx bin/cli.ts airdrop --keypair ~/my-wallet.json
```

You'll be asked for:
1. **Token mint address** — the token you want to airdrop
2. **Recipient method** — choose one:

#### Snapshot mode

Automatically fetches all on-chain holders of a source token and airdrops to them.

```
Choose (1/2/3): 1
Source token mint: <TOKEN_WHOSE_HOLDERS_GET_THE_AIRDROP>
Found 200 holders

Distribution method:
  1. Equal    — Same amount to each holder
  2. Pro-rata — Proportional to their holdings
```

- **Equal** — Every holder gets the same amount
- **Pro-rata** — Bigger holders get proportionally more

#### CSV mode

```
Choose (1/2/3): 2
Path to CSV file: recipients.csv
```

See [CSV Format](#csv-format) for file structure.

#### Manual mode

Enter addresses one by one. Press enter with an empty wallet to finish.

```
Choose (1/2/3): 3
Wallet address: 7jkBvmHpo5T...
Amount (raw tokens): 1000000
Added. (1 total)

Wallet address: (press enter to finish)
```

---

### 2. `csv` — Direct CSV Airdrop

Skip prompts and run a CSV airdrop directly.

```bash
npx tsx bin/cli.ts csv \
  --mint <MINT_ADDRESS> \
  --csv recipients.csv \
  --cluster devnet
```

**All options:**

```
-m, --mint <address>     Token mint address (required)
-f, --csv <path>         Path to CSV file (required)
-c, --cluster <cluster>  Solana cluster (default: "devnet")
--rpc <url>              Custom RPC endpoint
--keypair <path>         Path to keypair file
--dry-run                Preview without sending
-y, --yes                Skip confirmation prompt
--max-cost <sol>         Abort if cost exceeds limit
-o, --output <path>      Save JSON receipt
--output-csv <path>      Save CSV receipt
--webhook <url>          POST results when done
--resume                 Resume a failed airdrop
```

**Examples:**

```bash
# Dry run first
npx tsx bin/cli.ts csv -m <MINT> -f airdrop.csv --dry-run

# Run with auto-confirm and save receipt
npx tsx bin/cli.ts csv -m <MINT> -f airdrop.csv -y -o receipt.json

# Resume after failure
npx tsx bin/cli.ts csv -m <MINT> -f airdrop.csv --resume
```

---

### 3. `send` — Inline Batch Send

Send tokens to multiple wallets directly from CLI args. No CSV file needed.

```bash
npx tsx bin/cli.ts send \
  --mint <MINT_ADDRESS> \
  --to wallet1,wallet2,wallet3 \
  --amount 1000000
```

**All options:**

```
-m, --mint <address>     Token mint address (required)
-t, --to <wallets>       Comma-separated wallet addresses (required)
-a, --amount <amount>    Token amount per recipient in raw units (required)
-c, --cluster <cluster>  Solana cluster (default: "devnet")
--rpc <url>              Custom RPC endpoint
--keypair <path>         Path to keypair file
--dry-run                Preview without sending
-y, --yes                Skip confirmation prompt
--max-cost <sol>         Abort if cost exceeds limit
-o, --output <path>      Save JSON receipt
--output-csv <path>      Save CSV receipt
--webhook <url>          POST results when done
--resume                 Resume a failed send
```

**Examples:**

```bash
# Send 1 token (6 decimals) to 3 wallets
npx tsx bin/cli.ts send \
  -m <MINT> \
  -t 7jkBvm...,ptokFj...,Dyd2V2... \
  -a 1000000

# Dry run to preview
npx tsx bin/cli.ts send \
  -m <MINT> \
  -t 7jkBvm...,ptokFj... \
  -a 1000000 \
  --dry-run

# Send with cost limit and receipt
npx tsx bin/cli.ts send \
  -m <MINT> \
  -t 7jkBvm...,ptokFj... \
  -a 1000000 \
  --max-cost 0.5 \
  -o receipt.json \
  -y
```

---

### 4. `send-sol` — Batch Send SOL

Send SOL (not tokens) to multiple wallets in batched transactions.

```bash
npx tsx bin/cli.ts send-sol \
  --to wallet1,wallet2,wallet3 \
  --amount 0.1
```

**All options:**

```
-t, --to <wallets>       Comma-separated wallet addresses (required)
-a, --amount <sol>       SOL amount per recipient (required)
-c, --cluster <cluster>  Solana cluster (default: "devnet")
--rpc <url>              Custom RPC endpoint
--keypair <path>         Path to keypair file
--dry-run                Preview without sending
-y, --yes                Skip confirmation prompt
--max-cost <sol>         Abort if cost exceeds limit
-o, --output <path>      Save JSON receipt
--output-csv <path>      Save CSV receipt
--webhook <url>          POST results when done
--resume                 Resume a failed send
```

**Examples:**

```bash
# Send 0.05 SOL to 5 wallets
npx tsx bin/cli.ts send-sol \
  -t wallet1,wallet2,wallet3,wallet4,wallet5 \
  -a 0.05

# Dry run
npx tsx bin/cli.ts send-sol \
  -t wallet1,wallet2 \
  -a 0.1 \
  --dry-run

# Send with webhook notification
npx tsx bin/cli.ts send-sol \
  -t wallet1,wallet2 \
  -a 0.5 \
  -y \
  --webhook https://hooks.slack.com/your-webhook
```

**Notes:**
- Amount is in SOL (not lamports). `0.1` = 0.1 SOL
- Checks balance before sending — aborts if insufficient
- Uses ALT for >21 recipients

---

### 5. `multi-send` — Multi-Token Batch

Send different tokens with different amounts to different wallets from a single JSON file.

```bash
npx tsx bin/cli.ts multi-send \
  --file transfers.json
```

**All options:**

```
-f, --file <path>        Path to JSON file with transfers (required)
-c, --cluster <cluster>  Solana cluster (default: "devnet")
--rpc <url>              Custom RPC endpoint
--keypair <path>         Path to keypair file
--dry-run                Preview without sending
-y, --yes                Skip confirmation prompt
--max-cost <sol>         Abort if cost exceeds limit
-o, --output <path>      Save JSON receipt
--output-csv <path>      Save CSV receipt
--webhook <url>          POST results when done
```

**Examples:**

```bash
# Preview first
npx tsx bin/cli.ts multi-send -f transfers.json --dry-run

# Run with receipt
npx tsx bin/cli.ts multi-send -f transfers.json -y -o receipt.json --output-csv receipt.csv
```

See [JSON Format](#json-format-multi-send) for file structure.

---

### 6. `estimate` — Cost Calculator

Compare P-Token vs SPL Token costs before you run an airdrop. No wallet or tokens needed.

```bash
npx tsx bin/cli.ts estimate --recipients 500
```

**Output:**

```
╔══════════════════════════════════════════════════════════════════╗
║              AIRDROP COST ESTIMATE                               ║
║              500    recipients                                   ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║                     SPL Token        P-Token         Savings     ║
║   Compute Units     2,322,500        39,000          98.3%       ║
║   CU/transfer       4,645            78              98.3%       ║
║   Transactions      25               9               64.0%       ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

**Options:**

```
-n, --recipients <number>  Number of recipients (required)
```

---

### 7. `demo` — Live Benchmark

Run a live benchmark on devnet. Creates random wallets, mints test tokens, and compares P-Token vs SPL Token performance.

```bash
# Quick test (20 recipients)
npx tsx bin/cli.ts demo

# Full benchmark (200 recipients)
npx tsx bin/cli.ts demo --recipients 200 --cluster devnet
```

**Options:**

```
-n, --recipients <number>  Number of recipients (default: "20")
-c, --cluster <cluster>    Solana cluster (default: "devnet")
--rpc <url>                Custom RPC endpoint
--keypair <path>           Path to keypair file
```

---

## Global Options

These options work with all commands:

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --cluster <cluster>` | Solana cluster (`devnet`, `testnet`, `mainnet`) | `devnet` |
| `--rpc <url>` | Custom RPC endpoint (overrides cluster) | — |
| `--keypair <path>` | Path to keypair JSON file | `~/.config/solana/id.json` |

---

## Safety Features

### Dry Run

Preview exactly what will happen without sending any transactions.

```bash
npx tsx bin/cli.ts send -m <MINT> -t wallet1,wallet2 -a 1000000 --dry-run
```

Shows:
- Number of recipients
- Total tokens/SOL being sent
- Estimated transaction count
- Estimated compute units
- First 10 recipients preview

### Confirmation Prompt

Every send command asks for confirmation before executing:

```
Send 1000000 tokens to 50 wallets on devnet? (y/n):
```

Skip with `-y` or `--yes` for automated scripts:

```bash
npx tsx bin/cli.ts csv -m <MINT> -f recipients.csv -y
```

### Max Cost Limit

Set a SOL ceiling. If estimated cost exceeds it, pdrop aborts before sending anything.

```bash
npx tsx bin/cli.ts send -m <MINT> -t wallet1,wallet2 -a 1000000 --max-cost 0.5
```

```
Error: Estimated cost (~0.6234 SOL) exceeds --max-cost limit (0.5 SOL). Aborting.
```

### Balance Check

Before any token send, pdrop verifies:
- Your wallet has enough **tokens** for all recipients combined
- For `send-sol`, your wallet has enough **SOL**

Fails fast with a clear error instead of crashing mid-airdrop:

```
Error: Insufficient token balance. Need 50000000, have 10000000
```

### Resume Failed Airdrops

If an airdrop crashes or your connection drops mid-transfer, pdrop saves progress to `.pdrop-resume.json`.

Re-run the same command with `--resume` to continue from where it stopped:

```bash
# Original command that failed at recipient 150/500
npx tsx bin/cli.ts csv -m <MINT> -f recipients.csv

# Resume — skips the first 150, continues from 151
npx tsx bin/cli.ts csv -m <MINT> -f recipients.csv --resume
```

- Progress is saved after every batch of transactions
- Resume file is automatically deleted on successful completion
- Works with `send`, `csv`, and `send-sol` commands

---

## Output & Receipts

### JSON Receipt

Save a full receipt with every transfer detail:

```bash
npx tsx bin/cli.ts send -m <MINT> -t wallet1,wallet2 -a 1000000 -o receipt.json
```

**Output format:**

```json
{
  "timestamp": "2026-03-26T10:30:00.000Z",
  "cluster": "devnet",
  "payer": "8RwLrbQg...",
  "command": "send",
  "transfers": [
    {
      "wallet": "7jkBvmHpo5T...",
      "amount": "1000000",
      "mint": "ptokFjwy...",
      "signature": "5Kz8Y...",
      "status": "success"
    }
  ],
  "summary": {
    "totalTransfers": 2,
    "successCount": 2,
    "failedCount": 0,
    "totalCU": 156,
    "txCount": 1,
    "wallTimeMs": 2340
  }
}
```

### CSV Receipt

Export results as CSV for spreadsheets and accounting:

```bash
npx tsx bin/cli.ts csv -m <MINT> -f airdrop.csv --output-csv results.csv
```

**Output format:**

```csv
wallet,amount,mint,signature,status
7jkBvmHpo5T...,1000000,ptokFjwy...,5Kz8Y...,success
Dyd2V25x...,2000000,ptokFjwy...,5Kz8Y...,success
```

### Webhook Notification

POST the full receipt JSON to any URL when the operation completes:

```bash
npx tsx bin/cli.ts send -m <MINT> -t wallet1,wallet2 -a 1000000 \
  --webhook https://hooks.slack.com/services/your/webhook/url
```

Useful for:
- Slack/Discord notifications
- Logging pipelines
- Automated workflows

The webhook receives the same JSON as the `--output` receipt.

---

## File Formats

### CSV Format

Used by `csv` and `airdrop` (CSV mode).

```csv
wallet,amount
7jkBvmHpo5TeveiEfppU11X8MW3WjRxe3AxAvz5az9AM,1000000
ptokFjwyJtrwCa9Kgo9xoDS59V4QccBGEaRFnRPnSdP,2000000
Dyd2V25xdrSj1MXvnSEHYT9ZQcwMPEbNTzPqDN2VQSka,500000
```

- **wallet** — Solana wallet address (base58)
- **amount** — Token amount in raw units (with 6 decimals: `1000000` = 1 token)
- Header row is optional (auto-detected)

### JSON Format (multi-send)

Used by `multi-send`. Supports multiple tokens in one file.

```json
[
  {
    "mint": "TokenMintAddressA...",
    "wallet": "RecipientWallet1...",
    "amount": "1000000"
  },
  {
    "mint": "TokenMintAddressA...",
    "wallet": "RecipientWallet2...",
    "amount": "2000000"
  },
  {
    "mint": "TokenMintAddressB...",
    "wallet": "RecipientWallet1...",
    "amount": "5000000"
  }
]
```

- **mint** — Token mint address (base58)
- **wallet** — Recipient wallet address (base58)
- **amount** — Token amount in raw units (string to support large numbers)
- Transfers are grouped by mint automatically

---

## How It Works

1. **Collects recipients** — via snapshot (on-chain scan), CSV file, manual entry, or inline args
2. **Checks token balance** — verifies you have enough tokens before starting
3. **Derives Associated Token Accounts** — for each recipient wallet
4. **Creates missing ATAs** — automatically in batches of 5 per transaction
5. **Builds an Address Lookup Table** — for large sends (>20 recipients), reducing address size from 32 bytes to 1 byte per account
6. **Packs up to 60 transfers per versioned transaction** using the ALT
7. **Saves progress** — after each batch for resume capability
8. **Measures actual CU consumed** — from on-chain transaction metadata
9. **Outputs results** — comparison table, receipt files, webhook

For small sends (20 or fewer recipients), regular transactions are used instead of ALTs.

---

## Why P-Token is 98% Cheaper

P-Token (built by [@0x_febo](https://x.com/0x_febo) and [@anza_xyz](https://x.com/anza_xyz)) replaces SPL Token with a Pinocchio-based implementation:

| Optimization | Impact |
|-------------|--------|
| **Zero-copy** | Direct byte offset reads — no serialization/deserialization |
| **No heap allocations** | Uses `no_std` Pinocchio framework |
| **No logging** | SPL Token logs every instruction name (~103 CU overhead) |
| **Transfer fast-path** | Detected at entrypoint, bypasses general dispatch |

**Result:** ~78 CU per transfer vs ~4,645 CU with SPL Token.

Approved via [SIMD-0266](https://github.com/solana-foundation/solana-improvement-documents/pull/266). Live on testnet and devnet.

---

## Project Structure

```
pdrop/
├── bin/
│   └── cli.ts                     # CLI entrypoint (7 commands)
├── src/
│   ├── commands/
│   │   ├── airdrop.ts             # Interactive airdrop (snapshot/CSV/manual)
│   │   ├── csv.ts                 # Direct CSV airdrop
│   │   ├── demo.ts                # Benchmark demo
│   │   ├── estimate.ts            # Cost calculator
│   │   ├── send.ts                # Inline batch send tokens
│   │   ├── send-sol.ts            # Batch send SOL
│   │   └── multi-send.ts          # Multi-token batch send
│   ├── core/
│   │   ├── alt-manager.ts         # Address Lookup Table lifecycle
│   │   ├── common.ts              # Shared utilities (confirm, receipt, resume, etc.)
│   │   ├── connection.ts          # RPC connection + retry logic
│   │   ├── ptoken-batch.ts        # ALT-packed transfer execution
│   │   ├── snapshot.ts            # On-chain token holder scanner
│   │   ├── spl-transfer.ts        # Standard SPL transfer builder
│   │   └── token-setup.ts         # Mint + account creation
│   ├── csv/
│   │   └── parser.ts              # CSV file parser + validation
│   ├── display/
│   │   ├── banner.ts              # ASCII art header
│   │   ├── progress.ts            # Spinner + progress utilities
│   │   └── results.ts             # Result tables + bar charts
│   ├── constants.ts               # Program IDs + limits
│   └── types.ts                   # TypeScript interfaces
├── recipients.csv                 # Example CSV file
├── transfers.json                 # Example JSON file (multi-send)
├── package.json
└── tsconfig.json
```

---

## Requirements

- **Node.js 18+**
- **Solana CLI** with a funded devnet wallet (`~/.config/solana/id.json`)
- **~2 SOL on devnet** for account creation fees

If your wallet has < 2 SOL on devnet, the demo command will attempt an airdrop automatically.

---

## Related

- [P-Token Benchmark](https://github.com/alizeeshan1234/p-token) — Full 25-instruction CU comparison
- [SIMD-0266](https://github.com/solana-foundation/solana-improvement-documents/pull/266) — The proposal that enables P-Token
- [Pinocchio](https://github.com/anza-xyz/pinocchio) — The zero-copy Solana framework P-Token is built on

---

## License

MIT
