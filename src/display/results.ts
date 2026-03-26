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

  // Explorer links
  if (spl.signatures.length > 0) {
    const splExplorer = `https://explorer.solana.com/tx/${spl.signatures[0]}?cluster=${cluster}`;
    console.log(chalk.cyan(`║  SPL tx:    ${chalk.dim(splExplorer.slice(0, 54))}  ║`));
  }
  if (ptoken.signatures.length > 0) {
    const ptokenExplorer = `https://explorer.solana.com/tx/${ptoken.signatures[0]}?cluster=${cluster}`;
    console.log(chalk.cyan(`║  P-Tok tx:  ${chalk.dim(ptokenExplorer.slice(0, 54))}  ║`));
  }

  console.log(chalk.cyan.bold(`╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  P-Token uses Pinocchio: zero-copy, no_std, no heap, no logging  ║
║  Approved via SIMD-0266 — built by @0x_febo & @anza_xyz          ║
║  github.com/alizeeshan1234/p-token-airdrop                       ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝`));
}
