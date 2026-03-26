import { PublicKey } from "@solana/web3.js";

export interface Recipient {
  wallet: PublicKey;
  ata: PublicKey;
  amount: bigint;
}

export interface BenchmarkResult {
  label: string;
  totalCU: number;
  txCount: number;
  wallTimeMs: number;
  signatures: string[];
  transferCount: number;
}

export interface AirdropConfig {
  cluster: string;
  rpcUrl: string;
  recipients: number;
  keypairPath: string;
}
