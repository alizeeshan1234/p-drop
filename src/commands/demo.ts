import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";

import { getConnection } from "../core/connection.js";
import { createMint, createTokenAccountsBatched, mintTokensTo } from "../core/token-setup.js";
import { runPTokenBenchmark } from "../core/ptoken-batch.js";
import { createALT, extendALT, waitForALTActivation } from "../core/alt-manager.js";
import { printBanner } from "../display/banner.js";
import { createSpinner, logSuccess, logSection } from "../display/progress.js";
import { printResults } from "../display/results.js";
import { DEMO_DECIMALS, DEMO_AMOUNT_PER_RECIPIENT } from "../constants.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export async function runDemo(options: {
  recipients: number;
  cluster: string;
  rpc?: string;
  keypair?: string;
}) {
  printBanner();

  const { recipients, cluster, rpc } = options;
  const connection = getConnection(cluster, rpc);

  // ── Load keypair ──────────────────────────────────────────────
  logSection("SETUP");

  const keypairPath = options.keypair || path.join(
    process.env.HOME || "~",
    ".config/solana/id.json",
  );

  let payer: Keypair;
  try {
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    payer = Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch {
    throw new Error(`Cannot load keypair from ${keypairPath}`);
  }

  const balance = await connection.getBalance(payer.publicKey);
  const solBalance = (balance / LAMPORTS_PER_SOL).toFixed(2);
  logSuccess(`Loaded wallet: ${payer.publicKey.toBase58().slice(0, 8)}...${payer.publicKey.toBase58().slice(-4)} (${solBalance} SOL)`);

  if (balance < 2 * LAMPORTS_PER_SOL) {
    const spinner = createSpinner("Requesting devnet airdrop...");
    spinner.start();
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      spinner.succeed("Airdropped 2 SOL");
    } catch {
      spinner.warn("Airdrop failed — ensure you have enough SOL");
    }
  }

  // ── Create mint ───────────────────────────────────────────────
  let spinner = createSpinner("Creating token mint...");
  spinner.start();
  const mint = await createMint(connection, payer, DEMO_DECIMALS);
  spinner.stop();
  logSuccess(`Created mint: ${mint.toBase58().slice(0, 8)}...${mint.toBase58().slice(-4)}`);

  // ── Create source token account ───────────────────────────────
  spinner = createSpinner("Creating source token account...");
  spinner.start();
  const { addresses: [sourceAccount] } = await createTokenAccountsBatched(
    connection, payer, mint, 1, 1,
  );
  spinner.stop();
  logSuccess(`Source account: ${sourceAccount.toBase58().slice(0, 8)}...${sourceAccount.toBase58().slice(-4)}`);

  // ── Create destination token accounts ─────────────────────────
  spinner = createSpinner(`Creating ${recipients} destination accounts...`);
  spinner.start();
  const { addresses: destAccounts } = await createTokenAccountsBatched(
    connection, payer, mint, recipients, 3,
    (done, total) => {
      spinner.text = `Creating destination accounts... ${done}/${total}`;
    },
  );
  spinner.stop();
  logSuccess(`Created ${recipients} destination accounts`);

  // ── Mint tokens ───────────────────────────────────────────────
  spinner = createSpinner("Minting tokens...");
  spinner.start();
  const totalNeeded = BigInt(recipients) * BigInt(DEMO_AMOUNT_PER_RECIPIENT);
  await mintTokensTo(connection, payer, mint, sourceAccount, totalNeeded);
  spinner.stop();
  logSuccess(`Minted ${Number(totalNeeded / 1_000_000n).toLocaleString()} tokens to source`);

  // ═══════════════════════════════════════════════════════════════
  // P-TOKEN AIRDROP (via SIMD-0266)
  // ═══════════════════════════════════════════════════════════════
  logSection("P-TOKEN AIRDROP VIA SIMD-0266");

  // Create ALT with all relevant addresses
  spinner = createSpinner("Creating Address Lookup Table...");
  spinner.start();
  const altAddress = await createALT(connection, payer);
  spinner.stop();
  logSuccess("Created Address Lookup Table");

  spinner = createSpinner("Loading addresses into ALT...");
  spinner.start();
  const altAddresses = [
    TOKEN_PROGRAM_ID,
    sourceAccount, ...destAccounts,
  ];
  await extendALT(connection, payer, altAddress, altAddresses, (done, total) => {
    spinner.text = `Loading addresses into ALT... ${done}/${total}`;
  });
  spinner.stop();
  logSuccess(`Added ${altAddresses.length} addresses to ALT`);

  // Wait for ALT activation
  spinner = createSpinner("Waiting for ALT activation...");
  spinner.start();
  const altAccount = await waitForALTActivation(connection, altAddress, altAddresses.length);
  spinner.stop();
  logSuccess(`ALT activated (${altAccount.state.addresses.length} addresses)`);

  // Run P-Token transfers
  spinner = createSpinner(`Sending ${recipients} transfers via P-Token...`);
  spinner.start();

  const ptokenResult = await runPTokenBenchmark(
    connection,
    payer,
    sourceAccount,
    destAccounts,
    BigInt(DEMO_AMOUNT_PER_RECIPIENT),
    altAccount,
    (done, total) => {
      spinner.text = `P-Token transfers... ${done}/${total}`;
    },
  );

  spinner.stop();
  logSuccess(`Total CU: ${ptokenResult.totalCU.toLocaleString()} | Time: ${(ptokenResult.wallTimeMs / 1000).toFixed(1)}s | ${ptokenResult.txCount} txs`);

  // ═══════════════════════════════════════════════════════════════
  // RESULTS — Compare actual P-Token vs theoretical SPL Token
  // ═══════════════════════════════════════════════════════════════
  logSection("RESULTS");

  // SPL Token theoretical numbers (pre-SIMD-0266)
  const splCUPerTransfer = 4_645;
  const splTransfersPerTx = 20; // max without ALT (no v0 tx support pre-SIMD-0266)
  const splTxCount = Math.ceil(recipients / splTransfersPerTx);
  const splTotalCU = recipients * splCUPerTransfer;
  // Scale SPL wall time proportionally from P-Token actual time
  const splWallTimeMs = Math.round(ptokenResult.wallTimeMs * (splTxCount / Math.max(ptokenResult.txCount, 1)));

  const splResult = {
    label: "SPL Token (pre-SIMD-0266)",
    totalCU: splTotalCU,
    txCount: splTxCount,
    wallTimeMs: splWallTimeMs,
    signatures: [] as string[],
    transferCount: recipients,
  };

  printResults(splResult, ptokenResult, cluster);
}
