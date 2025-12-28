"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ConnectionProvider, useConnection, useWallet as useAdapterWallet, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import { PhantomWalletAdapter, SolflareWalletAdapter, TorusWalletAdapter } from "@solana/wallet-adapter-wallets"

import "@solana/wallet-adapter-react-ui/styles.css"

export interface WalletContextType {
  publicKey: string | null
  connected: boolean
  connecting: boolean
  connect: () => Promise<void>
  disconnect: () => void
  balance: number
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    if (customRpc) {
      console.log("[v0] Using custom RPC endpoint")
      return customRpc
    }
    console.log("[v0] Using default Helius public RPC")
    return "https://mainnet.helius-rpc.com/v0/public"
  }, [])

  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new TorusWalletAdapter()], [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletContextBridge>{children}</WalletContextBridge>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  )
}

function WalletContextBridge({ children }: { children: ReactNode }) {
  const { connection } = useConnection()
  const { publicKey, connected, connecting, disconnect, connect } = useAdapterWallet()
  const [balance, setBalance] = useState(0)

  useEffect(() => {
    let subId: number | null = null

    async function refresh() {
      if (!connected || !publicKey) {
        setBalance(0)
        return
      }

      const lamports = await connection.getBalance(publicKey, "confirmed")
      setBalance(lamports / 1e9)
    }

    refresh().catch(() => {
      setBalance(0)
    })

    if (connected && publicKey) {
      subId = connection.onAccountChange(
        publicKey,
        (info) => {
          setBalance(info.lamports / 1e9)
        },
        "confirmed",
      )
    }

    return () => {
      if (subId !== null) {
        connection.removeAccountChangeListener(subId).catch(() => {})
      }
    }
  }, [connection, connected, publicKey])

  const value: WalletContextType = {
    publicKey: publicKey ? publicKey.toBase58() : null,
    connected,
    connecting,
    connect: async () => {
      await connect()
    },
    disconnect: () => {
      disconnect().catch(() => {})
    },
    balance,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
