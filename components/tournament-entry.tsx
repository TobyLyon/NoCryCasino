"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useWallet, useConnection } from "@solana/wallet-adapter-react"
import { Shield, Lock, CheckCircle2, AlertTriangle } from "lucide-react"
import { useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { depositToEscrow, depositToEscrowAddress } from "@/lib/solana/escrow"
import { verifyAndCreateEntry } from "@/lib/tournament-entry"

interface Tournament {
  id: string
  title: string
  prizePool: number
  entryFee: number
  participants: number
  maxParticipants: number
  status: "live" | "upcoming" | "ended"
  escrowWalletAddress?: string | null
}

export function TournamentEntry({ tournament }: { tournament: Tournament }) {
  const { publicKey, connected, sendTransaction, wallet, connect } = useWallet()
  const { connection } = useConnection()
  const [isEntering, setIsEntering] = useState(false)
  const [showConflictDialog, setShowConflictDialog] = useState(false)
  const [conflictMessage, setConflictMessage] = useState("")
  const { toast } = useToast()

  const handleEntry = async () => {
    if (!connected || !publicKey || !sendTransaction) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to enter the tournament",
        variant: "destructive",
      })
      return
    }

    if (!wallet?.adapter?.connected) {
      try {
        await connect()
      } catch (error) {
        toast({
          title: "Connection failed",
          description: "Please try connecting your wallet again",
          variant: "destructive",
        })
        return
      }
    }

    setIsEntering(true)

    try {
      const eligibilityResponse = await fetch("/api/tournaments/check-eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toBase58(),
          tournamentId: tournament.id,
        }),
      })

      const eligibilityData = await eligibilityResponse.json()

      if (!eligibilityData.eligible) {
        // Show conflict dialog WITHOUT processing payment
        if (eligibilityData.reason === "ALREADY_ENTERED") {
          setConflictMessage(
            "You've already entered this tournament with your current wallet. Each wallet can only enter once per tournament.",
          )
        } else if (eligibilityData.reason === "IN_OTHER_TOURNAMENT") {
          setConflictMessage(
            `You're already in an active tournament: ${eligibilityData.tournamentName || "another tournament"}. Please wait until it's complete or use a new wallet.`,
          )
        }
        setShowConflictDialog(true)
        setIsEntering(false)
        return
      }

      // Only proceed with payment if eligible
      const signature =
        typeof tournament.escrowWalletAddress === "string" && tournament.escrowWalletAddress.trim().length > 0
          ? await depositToEscrowAddress(
              connection,
              publicKey,
              tournament.entryFee,
              tournament.escrowWalletAddress.trim(),
              sendTransaction,
            )
          : await depositToEscrow(connection, publicKey, tournament.entryFee, sendTransaction)

      const result = await verifyAndCreateEntry(publicKey.toBase58(), tournament.id, signature, tournament.entryFee)

      if (!result.success) {
        throw new Error(result.message)
      }

      toast({
        title: "Entry successful!",
        description: `You've entered the tournament. ${tournament.entryFee} SOL has been escrowed.`,
      })

      setTimeout(() => window.location.reload(), 1500)
    } catch (error: any) {
      console.error("[v0] Entry failed:", error)

      let errorMessage = "Failed to process tournament entry."

      if (error?.message?.includes("User rejected") || error?.message?.includes("cancelled")) {
        errorMessage = "You cancelled the transaction."
      } else if (error?.message?.includes("not been authorized")) {
        errorMessage = "Please reconnect your wallet and try again."
      } else if (error?.message?.includes("Insufficient")) {
        errorMessage = `You need at least ${tournament.entryFee} SOL in your wallet.`
      } else if (error?.message?.includes("Network")) {
        errorMessage = "Network connection issue. Please check your RPC endpoint."
      }

      toast({
        title: "Entry failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsEntering(false)
    }
  }

  return (
    <>
      <Card className="p-6 sticky top-24">
        <h3 className="text-xl font-bold mb-4">Enter Tournament</h3>

        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-muted">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Entry Fee</span>
              <span className="font-bold text-lg">{tournament.entryFee} SOL</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Prize Pool</span>
              <span className="font-semibold">{tournament.prizePool} SOL</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 text-sm">
              <Shield className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold mb-1">Secure Escrow</div>
                <div className="text-muted-foreground">
                  Your entry fee is held in a smart contract until the tournament ends
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 text-sm">
              <Lock className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold mb-1">Trustless Payout</div>
                <div className="text-muted-foreground">
                  Winner automatically receives the full prize pool on completion
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 text-sm">
              <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold mb-1">Instant Settlement</div>
                <div className="text-muted-foreground">No waiting periods or manual verification required</div>
              </div>
            </div>
          </div>

          <Button
            onClick={handleEntry}
            disabled={!connected || isEntering || tournament.participants >= tournament.maxParticipants}
            className="w-full"
            size="lg"
          >
            {!connected
              ? "Connect Wallet to Enter"
              : isEntering
                ? "Checking Eligibility..."
                : tournament.participants >= tournament.maxParticipants
                  ? "Tournament Full"
                  : `Enter for ${tournament.entryFee} SOL`}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            By entering, you agree to the tournament rules and escrow terms
          </p>
        </div>
      </Card>

      <Dialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-6 w-6 text-yellow-500" />
              <DialogTitle>Cannot Enter Tournament</DialogTitle>
            </div>
            <DialogDescription className="text-base pt-2">
              {conflictMessage}
              <br />
              <br />
              <span className="font-semibold">
                Please wait until your current tournament is complete or use a new wallet.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-col gap-2">
            <Button onClick={() => setShowConflictDialog(false)} className="w-full">
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
