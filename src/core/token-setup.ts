import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { sendAndConfirm } from "./connection.js";

const TOKEN_ACCOUNT_SIZE = 165;

export async function createMint(
  connection: Connection,
  payer: Keypair,
  decimals: number,
): Promise<PublicKey> {
  const mintKp = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      lamports,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKp.publicKey,
      decimals,
      payer.publicKey,
      payer.publicKey,
    ),
  );

  await sendAndConfirm(connection, tx, [payer, mintKp]);
  return mintKp.publicKey;
}

export async function createTokenAccountsBatched(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  count: number,
  batchSize = 3,
  onProgress?: (done: number, total: number) => void,
): Promise<{ keypairs: Keypair[]; addresses: PublicKey[] }> {
  const keypairs: Keypair[] = [];
  const addresses: PublicKey[] = [];
  const rent = await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);

  for (let i = 0; i < count; i += batchSize) {
    const batchCount = Math.min(batchSize, count - i);
    const batchKps: Keypair[] = [];

    const tx = new Transaction();
    for (let j = 0; j < batchCount; j++) {
      const kp = Keypair.generate();
      batchKps.push(kp);

      tx.add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: kp.publicKey,
          lamports: rent,
          space: TOKEN_ACCOUNT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        new TransactionInstruction({
          keys: [
            { pubkey: kp.publicKey, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          ],
          programId: TOKEN_PROGRAM_ID,
          data: Buffer.from([1]), // InitializeAccount
        }),
      );
    }

    await sendAndConfirm(connection, tx, [payer, ...batchKps]);
    keypairs.push(...batchKps);
    addresses.push(...batchKps.map((kp) => kp.publicKey));

    if (onProgress) onProgress(Math.min(i + batchSize, count), count);
    await new Promise((r) => setTimeout(r, 200));
  }

  return { keypairs, addresses };
}

export async function mintTokensTo(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  amount: bigint,
): Promise<void> {
  const tx = new Transaction().add(
    createMintToInstruction(mint, destination, payer.publicKey, amount),
  );
  await sendAndConfirm(connection, tx, [payer]);
}
