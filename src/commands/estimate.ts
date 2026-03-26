import chalk from "chalk";

import { printBanner } from "../display/banner.js";
import { logSection, logSuccess } from "../display/progress.js";
import { estimateAirdropCost } from "../core/common.js";

export async function runEstimate(options: {
  recipients: number;
}) {
  printBanner();
  logSection("COST ESTIMATE");

  const count = options.recipients;
  const { ptokenCU, splCU, estimatedTxs, estimatedSolCost } = estimateAirdropCost(count);

  const splTxs = Math.ceil(count / 20);
  const splSolCost = splTxs * 0.000005;

  const cuSavings = ((1 - ptokenCU / splCU) * 100).toFixed(1);
  const txSavings = ((1 - estimatedTxs / splTxs) * 100).toFixed(1);

  const useALT = count > 20;

  console.log(chalk.cyan.bold(`
  ╔══════════════════════════════════════════════════════════════════╗
  ║              AIRDROP COST ESTIMATE                               ║
  ║              ${String(count).padEnd(6)} recipients                                  ║
  ╠══════════════════════════════════════════════════════════════════╣
  ║                                                                  ║
  ║                     SPL Token        P-Token         Savings     ║
  ║   ──────────────    ──────────       ─────────       ────────    ║
  ║   Compute Units     ${String(splCU.toLocaleString()).padEnd(16)} ${chalk.green(String(ptokenCU.toLocaleString()).padEnd(16))} ${chalk.yellow((cuSavings + "%").padEnd(8))}   ║
  ║   CU/transfer       ${String("4,645").padEnd(16)} ${chalk.green(String("78").padEnd(16))} ${chalk.yellow("98.3%".padEnd(8))}   ║
  ║   Transactions      ${String(splTxs).padEnd(16)} ${chalk.green(String(estimatedTxs).padEnd(16))} ${chalk.yellow((txSavings + "%").padEnd(8))}   ║
  ║   Est. SOL cost     ${String(splSolCost.toFixed(6)).padEnd(16)} ${chalk.green(String(estimatedSolCost.toFixed(6)).padEnd(16))}             ║
  ║   Uses ALT?         ${"No".padEnd(16)} ${chalk.green(String(useALT ? "Yes" : "No").padEnd(16))}             ║
  ║   Transfers/tx      ${"20".padEnd(16)} ${chalk.green(String(useALT ? "60" : "20").padEnd(16))}             ║
  ║                                                                  ║
  ╠══════════════════════════════════════════════════════════════════╣
  ║                                                                  ║
  ║   ${chalk.green("P-Token saves " + cuSavings + "% compute and " + txSavings + "% transactions")}${" ".repeat(Math.max(0, 21 - cuSavings.length - txSavings.length))}║
  ║                                                                  ║
  ║   Note: Estimates exclude ATA creation costs for new accounts.   ║
  ║   Each new ATA costs ~0.002 SOL in rent.                         ║
  ║                                                                  ║
  ╚══════════════════════════════════════════════════════════════════╝`));
}
