import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
import { retryWithBackoff } from "./connection.js";

export interface TokenHolder {
  owner: PublicKey;
  balance: bigint;
  tokenAccount: PublicKey;
}

/**
 * Fetch all holders of a token mint using getProgramAccounts.
 */
export async function getTokenHolders(
  connection: Connection,
  mint: PublicKey,
  excludeAddresses: PublicKey[] = [],
): Promise<TokenHolder[]> {
  const excludeSet = new Set(excludeAddresses.map((a) => a.toBase58()));

  const accounts = await retryWithBackoff(() =>
    connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: mint.toBase58() } },
      ],
    }),
  );

  const holders: TokenHolder[] = [];

  for (const { pubkey, account } of accounts) {
    const data = AccountLayout.decode(account.data);
    const balance = BigInt(data.amount.toString());
    if (balance === 0n) continue;

    const owner = new PublicKey(data.owner);
    if (excludeSet.has(owner.toBase58())) continue;

    holders.push({ owner, balance, tokenAccount: pubkey });
  }

  holders.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  return holders;
}
