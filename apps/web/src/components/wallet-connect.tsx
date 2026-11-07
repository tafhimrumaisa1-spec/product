"use client";

import { useState } from "react";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

export function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleWallet() {
    setError(null);
    const provider = window.phantom?.solana;
    if (!provider?.isPhantom) {
      window.open("https://phantom.com/download", "_blank", "noopener,noreferrer");
      setError("Install Phantom to use Live Devnet mode.");
      return;
    }

    try {
      if (address) {
        await provider.disconnect();
        setAddress(null);
        return;
      }
      const connection = await provider.connect();
      setAddress(connection.publicKey.toString());
    } catch {
      setError("Wallet connection was cancelled.");
    }
  }

  return (
    <div className="wallet-control">
      <button className="button button-small" onClick={toggleWallet} type="button">
        {address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Connect Phantom"}
      </button>
      {error && <span role="status">{error}</span>}
    </div>
  );
}
