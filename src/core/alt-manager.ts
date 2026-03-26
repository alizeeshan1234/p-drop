import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { retryWithBackoff, sendAndConfirm } from "./connection.js";
import { MAX_ALT_EXTEND_PER_TX } from "../constants.js";

export async function createALT(
  connection: Connection,
  payer: Keypair,
): Promise<PublicKey> {
  // Use finalized slot to avoid "not a recent slot" errors
  const slot = await connection.getSlot("finalized");

  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  const tx = new Transaction().add(createIx);
  await sendAndConfirm(connection, tx, [payer]);

  return altAddress;
}

export async function extendALT(
  connection: Connection,
  payer: Keypair,
  altAddress: PublicKey,
  addresses: PublicKey[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < addresses.length; i += MAX_ALT_EXTEND_PER_TX) {
    const batch = addresses.slice(i, i + MAX_ALT_EXTEND_PER_TX);

    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: altAddress,
      addresses: batch,
    });

    const tx = new Transaction().add(extendIx);
    await sendAndConfirm(connection, tx, [payer]);

    if (onProgress) onProgress(Math.min(i + MAX_ALT_EXTEND_PER_TX, addresses.length), addresses.length);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function waitForALTActivation(
  connection: Connection,
  altAddress: PublicKey,
  expectedAddresses: number,
  maxWaitMs = 10000,
): Promise<AddressLookupTableAccount> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const result = await connection.getAddressLookupTable(altAddress);
    if (
      result.value &&
      result.value.state.addresses.length >= expectedAddresses
    ) {
      // Extra wait to ensure validators have caught up
      await new Promise((r) => setTimeout(r, 1000));
      // Re-fetch to get the most up-to-date state
      const confirmed = await connection.getAddressLookupTable(altAddress);
      if (confirmed.value) return confirmed.value;
      return result.value;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Return whatever we have
  const result = await connection.getAddressLookupTable(altAddress);
  if (result.value) return result.value;
  throw new Error("ALT activation timed out");
}

export async function buildAndSendVersionedTx(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  altAccount: AddressLookupTableAccount,
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([altAccount]);

  const tx = new VersionedTransaction(messageV0);
  tx.sign([payer]);

  const sig = await retryWithBackoff(() =>
    connection.sendTransaction(tx, { skipPreflight: false }),
  );
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
