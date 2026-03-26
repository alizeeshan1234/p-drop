import { PublicKey } from "@solana/web3.js";
import fs from "fs";

export interface CsvRecipient {
  wallet: PublicKey;
  amount: bigint;
}

export function parseRecipientsCSV(filePath: string): CsvRecipient[] {
  const content = fs.readFileSync(filePath, "utf-8").trim();
  const lines = content.split("\n");

  // Skip header if present
  const startIdx = lines[0].toLowerCase().includes("wallet") ? 1 : 0;

  const recipients: CsvRecipient[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",").map((s) => s.trim());
    if (parts.length < 2) {
      throw new Error(`Line ${i + 1}: expected "wallet,amount" but got "${line}"`);
    }

    let wallet: PublicKey;
    try {
      wallet = new PublicKey(parts[0]);
    } catch {
      throw new Error(`Line ${i + 1}: invalid wallet address "${parts[0]}"`);
    }

    const amount = BigInt(parts[1]);
    if (amount <= 0n) {
      throw new Error(`Line ${i + 1}: amount must be positive, got ${parts[1]}`);
    }

    recipients.push({ wallet, amount });
  }

  if (recipients.length === 0) {
    throw new Error("CSV file has no recipients");
  }

  return recipients;
}
