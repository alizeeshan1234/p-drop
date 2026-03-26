import chalk from "chalk";
import type { BenchmarkResult } from "../types.js";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

function makeBar(value: number, maxValue: number, width = 35): string {
  const filled = Math.max(1, Math.round((value / maxValue) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function savings(spl: number, ptoken: number): string {
  if (spl === 0) return "—";
  return ((1 - ptoken / spl) * 100).toFixed(1) + "%";
}

export function printResults(
  spl: BenchmarkResult,
  ptoken: BenchmarkResult,
  cluster: string,
) {
  const splCUPerTx = spl.transferCount > 0 ? Math.round(spl.totalCU / spl.transferCount) : 0;
  const ptokenCUPerTx = ptoken.transferCount > 0 ? Math.round(ptoken.totalCU / ptoken.transferCount) : 0;

  const maxCU = Math.max(spl.totalCU, ptoken.totalCU);
  const maxTx = Math.max(spl.txCount, ptoken.txCount);
  const maxTime = Math.max(spl.wallTimeMs, ptoken.wallTimeMs);

  console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════════╗
║              SPL TOKEN vs P-TOKEN AIRDROP                       ║
║              ${String(spl.transferCount).padEnd(4)} recipients on ${cluster.padEnd(22)}         ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   Metric           SPL Token       P-Token       Savings        ║
║   ─────────────    ──────────      ─────────     ────────       ║
║   Total CU         ${formatNumber(spl.totalCU).padEnd(14)} ${chalk.green(formatNumber(ptoken.totalCU).padEnd(13))} ${chalk.yellow(savings(spl.totalCU, ptoken.totalCU).padEnd(8))}       ║
║   Transactions     ${String(spl.txCount).padEnd(14)} ${chalk.green(String(ptoken.txCount).padEnd(13))} ${chalk.yellow(savings(spl.txCount, ptoken.txCount).padEnd(8))}       ║
║   Wall Time        ${formatTime(spl.wallTimeMs).padEnd(14)} ${chalk.green(formatTime(ptoken.wallTimeMs).padEnd(13))} ${chalk.yellow(savings(spl.wallTimeMs, ptoken.wallTimeMs).padEnd(8))}       ║
║   CU/transfer      ${formatNumber(splCUPerTx).padEnd(14)} ${chalk.green(formatNumber(ptokenCUPerTx).padEnd(13))} ${chalk.yellow(savings(splCUPerTx, ptokenCUPerTx).padEnd(8))}       ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   Compute Units:                                                 ║
║   SPL    ${makeBar(spl.totalCU, maxCU)}  ${formatNumber(spl.totalCU).padStart(10)}  ║
║   P-Tok  ${chalk.green(makeBar(ptoken.totalCU, maxCU))}  ${chalk.green(formatNumber(ptoken.totalCU).padStart(10))}  ║
║                                                                  ║
║   Transactions:                                                  ║
║   SPL    ${makeBar(spl.txCount, maxTx, 20)}  ${String(spl.txCount).padStart(4)} txs             ║
║   P-Tok  ${chalk.green(makeBar(ptoken.txCount, maxTx, 20))}  ${chalk.green(String(ptoken.txCount).padStart(4))} txs             ║
║                                                                  ║
║   Wall Time:                                                     ║
║   SPL    ${makeBar(spl.wallTimeMs, maxTime, 20)}  ${formatTime(spl.wallTimeMs).padStart(6)}               ║
║   P-Tok  ${chalk.green(makeBar(ptoken.wallTimeMs, maxTime, 20))}  ${chalk.green(formatTime(ptoken.wallTimeMs).padStart(6))}               ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣`));

  console.log(chalk.cyan.bold(`║                                                                  ║
║  P-Token uses Pinocchio: zero-copy, no_std, no heap, no logging  ║
║  Approved via SIMD-0266 — built by @0x_febo & @anza_xyz          ║
║  github.com/alizeeshan1234/pdrop                                 ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝`));

  // Explorer links (printed outside box so they aren't truncated)
  if (ptoken.signatures.length > 0) {
    console.log(chalk.dim(`\n  Verified on ${cluster}:`));
    for (const sig of ptoken.signatures) {
      console.log(chalk.cyan(`  https://explorer.solana.com/tx/${sig}?cluster=${cluster}`));
    }
  }
}

export function printCsvResults(
  result: BenchmarkResult,
  totalAmount: bigint,
  cluster: string,
) {
  const cuPerTransfer = result.transferCount > 0 ? Math.round(result.totalCU / result.transferCount) : 0;
  const splTotalCU = result.transferCount * 4_645;

  console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════════╗
║              P-TOKEN AIRDROP COMPLETE                            ║
║              ${String(result.transferCount).padEnd(4)} recipients on ${cluster.padEnd(22)}         ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   Transfers:        ${chalk.green(String(result.transferCount).padEnd(40))}     ║
║   Total tokens:     ${chalk.green(String(totalAmount).padEnd(40))}     ║
║   Transactions:     ${chalk.green(String(result.txCount).padEnd(40))}     ║
║   Wall Time:        ${chalk.green(formatTime(result.wallTimeMs).padEnd(40))}     ║
║   Total CU:         ${chalk.green(formatNumber(result.totalCU).padEnd(40))}     ║
║   CU/transfer:      ${chalk.green(formatNumber(cuPerTransfer).padEnd(40))}     ║
║                                                                  ║
║   Compute saved vs SPL Token:                                    ║
║   SPL would use:    ${formatNumber(splTotalCU).padEnd(40)}     ║
║   P-Token used:     ${chalk.green(formatNumber(result.totalCU).padEnd(40))}     ║
║   Savings:          ${chalk.yellow(savings(splTotalCU, result.totalCU).padEnd(40))}     ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝`));

  if (result.signatures.length > 0) {
    console.log(chalk.dim(`\n  Verified on ${cluster}:`));
    for (const sig of result.signatures) {
      console.log(chalk.cyan(`  https://explorer.solana.com/tx/${sig}?cluster=${cluster}`));
    }
  }
}

export function printSolResults(opts: {
  transferCount: number;
  totalSol: number;
  totalCU: number;
  txCount: number;
  wallTimeMs: number;
  signatures: string[];
  cluster: string;
}) {
  const cuPerTransfer = opts.transferCount > 0 ? Math.round(opts.totalCU / opts.transferCount) : 0;

  console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════════╗
║              SOL BATCH SEND COMPLETE                             ║
║              ${String(opts.transferCount).padEnd(4)} recipients on ${opts.cluster.padEnd(22)}         ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   Transfers:        ${chalk.green(String(opts.transferCount).padEnd(40))}     ║
║   Total SOL:        ${chalk.green(opts.totalSol.toFixed(4).padEnd(40))}     ║
║   Transactions:     ${chalk.green(String(opts.txCount).padEnd(40))}     ║
║   Wall Time:        ${chalk.green(formatTime(opts.wallTimeMs).padEnd(40))}     ║
║   Total CU:         ${chalk.green(formatNumber(opts.totalCU).padEnd(40))}     ║
║   CU/transfer:      ${chalk.green(formatNumber(cuPerTransfer).padEnd(40))}     ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝`));

  if (opts.signatures.length > 0) {
    console.log(chalk.dim(`\n  Verified on ${opts.cluster}:`));
    for (const sig of opts.signatures) {
      console.log(chalk.cyan(`  https://explorer.solana.com/tx/${sig}?cluster=${opts.cluster}`));
    }
  }
}

export function printMultiTokenResults(opts: {
  totalTransfers: number;
  mintCount: number;
  totalCU: number;
  txCount: number;
  wallTimeMs: number;
  signatures: string[];
  cluster: string;
}) {
  const cuPerTransfer = opts.totalTransfers > 0 ? Math.round(opts.totalCU / opts.totalTransfers) : 0;
  const splTotalCU = opts.totalTransfers * 4_645;

  console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════════╗
║              MULTI-TOKEN BATCH SEND COMPLETE                     ║
║              ${String(opts.totalTransfers).padEnd(4)} transfers across ${String(opts.mintCount).padEnd(2)} mints on ${opts.cluster.padEnd(10)}    ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   Total transfers:  ${chalk.green(String(opts.totalTransfers).padEnd(40))}     ║
║   Token mints:      ${chalk.green(String(opts.mintCount).padEnd(40))}     ║
║   Transactions:     ${chalk.green(String(opts.txCount).padEnd(40))}     ║
║   Wall Time:        ${chalk.green(formatTime(opts.wallTimeMs).padEnd(40))}     ║
║   Total CU:         ${chalk.green(formatNumber(opts.totalCU).padEnd(40))}     ║
║   CU/transfer:      ${chalk.green(formatNumber(cuPerTransfer).padEnd(40))}     ║
║                                                                  ║
║   Compute saved vs SPL Token:                                    ║
║   SPL would use:    ${formatNumber(splTotalCU).padEnd(40)}     ║
║   P-Token used:     ${chalk.green(formatNumber(opts.totalCU).padEnd(40))}     ║
║   Savings:          ${chalk.yellow(savings(splTotalCU, opts.totalCU).padEnd(40))}     ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝`));

  if (opts.signatures.length > 0) {
    console.log(chalk.dim(`\n  Verified on ${opts.cluster}:`));
    for (const sig of opts.signatures) {
      console.log(chalk.cyan(`  https://explorer.solana.com/tx/${sig}?cluster=${opts.cluster}`));
    }
  }
}
