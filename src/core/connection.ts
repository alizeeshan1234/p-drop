import { Connection, Keypair, Transaction, SendOptions } from "@solana/web3.js";

const CLUSTER_URLS: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export function getConnection(cluster: string, rpcUrl?: string): Connection {
  const url = rpcUrl || CLUSTER_URLS[cluster] || cluster;
  return new Connection(url, "confirmed");
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelay = 500,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 = err?.message?.includes("429") || err?.message?.includes("Too Many Requests");
      if (!is429 || i === maxRetries - 1) throw err;
      const delay = baseDelay * Math.pow(2, i) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Max retries exceeded");
}

export async function sendAndConfirm(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
): Promise<string> {
  return retryWithBackoff(async () => {
    const sig = await connection.sendTransaction(tx, signers, {
      skipPreflight: false,
    });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  });
}
