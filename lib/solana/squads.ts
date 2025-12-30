import * as multisig from "@sqds/multisig"
import { PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js"

function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim()
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed)
    if (!Array.isArray(arr)) throw new Error("SECRET_KEY_JSON_INVALID")
    const bytes = Uint8Array.from(arr)
    if (bytes.length !== 64) throw new Error("SECRET_KEY_LENGTH_INVALID")
    return bytes
  }

  const bytes = Uint8Array.from(Buffer.from(trimmed, "base64"))
  if (bytes.length !== 64) throw new Error("SECRET_KEY_LENGTH_INVALID")
  return bytes
}

async function getProposerKeypair() {
  const raw = process.env.SQUADS_PROPOSER_SECRET_KEY
  if (typeof raw !== "string" || raw.trim().length === 0) throw new Error("SQUADS_PROPOSER_SECRET_KEY_MISSING")

  const { Keypair } = await import("@solana/web3.js")
  return Keypair.fromSecretKey(parseSecretKey(raw))
}

function getMultisigPda(): PublicKey {
  const raw = process.env.SQUADS_MULTISIG_PDA
  if (typeof raw !== "string" || raw.trim().length === 0) throw new Error("SQUADS_MULTISIG_PDA_MISSING")
  return new PublicKey(raw.trim())
}

export type SquadsWithdrawalProposal = {
  multisigPda: string
  vaultPda: string
  vaultIndex: number
  transactionIndex: string
  proposalPda: string
  createSig: string
  proposalCreateSig: string
}

export async function createSquadsSolTransferProposal(args: {
  connection: any
  toAddress: string
  lamports: number
  vaultIndex: number
  memo?: string
}): Promise<SquadsWithdrawalProposal> {
  const multisigPda = getMultisigPda()
  const proposer = await getProposerKeypair()

  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: args.vaultIndex })

  const instruction = SystemProgram.transfer({
    fromPubkey: vaultPda,
    toPubkey: new PublicKey(args.toAddress),
    lamports: args.lamports,
  })

  const transferMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await args.connection.getLatestBlockhash()).blockhash,
    instructions: [instruction],
  })

  const info = await multisig.accounts.Multisig.fromAccountAddress(args.connection, multisigPda)
  const currentIdx = BigInt(String((info as any).transactionIndex))
  const transactionIndex = currentIdx + BigInt(1)

  const createSig = await multisig.rpc.vaultTransactionCreate({
    connection: args.connection,
    feePayer: proposer,
    multisigPda,
    transactionIndex,
    creator: proposer.publicKey,
    vaultIndex: args.vaultIndex,
    ephemeralSigners: 0,
    transactionMessage: transferMessage,
    memo: typeof args.memo === "string" && args.memo.length > 0 ? args.memo : "",
  })

  await args.connection.confirmTransaction(createSig, "confirmed")

  const proposalCreateSig = await multisig.rpc.proposalCreate({
    connection: args.connection,
    feePayer: proposer,
    multisigPda,
    transactionIndex,
    creator: proposer,
  })

  await args.connection.confirmTransaction(proposalCreateSig, "confirmed")

  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex })

  return {
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    vaultIndex: args.vaultIndex,
    transactionIndex: transactionIndex.toString(),
    proposalPda: proposalPda.toBase58(),
    createSig,
    proposalCreateSig,
  }
}
