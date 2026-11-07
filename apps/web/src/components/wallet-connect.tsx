"use client";

import { useEffect, useState } from "react";

interface PhantomPublicKey {
  toString(): string;
  toBase58?(): string;
}

interface PhantomProvider {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: PhantomPublicKey | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PhantomPublicKey }>;
  disconnect(): Promise<void>;
  on(event: "connect", listener: (publicKey: PhantomPublicKey) => void): void;
  on(event: "disconnect", listener: () => void): void;
  on(event: "accountChanged", listener: (publicKey: PhantomPublicKey | null) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

export function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const provider = window.phantom?.solana;
    if (!provider?.isPhantom) return;

    const connected = (publicKey: PhantomPublicKey) => setAddress(publicKey.toString());
    const disconnected = () => setAddress(null);
    const accountChanged = (publicKey: PhantomPublicKey | null) => setAddress(publicKey?.toString() ?? null);

    provider.on("connect", connected);
    provider.on("disconnect", disconnected);
    provider.on("accountChanged", accountChanged);
    if (provider.publicKey && provider.isConnected) connected(provider.publicKey);
    else provider.connect({ onlyIfTrusted: true }).then(({ publicKey }) => connected(publicKey)).catch(() => undefined);

    return () => {
      provider.removeListener?.("connect", connected as (...args: never[]) => void);
      provider.removeListener?.("disconnect", disconnected as (...args: never[]) => void);
      provider.removeListener?.("accountChanged", accountChanged as (...args: never[]) => void);
    };
  }, []);

  async function toggleWallet() {
    setError(null);
    const provider = window.phantom?.solana;
    if (!provider?.isPhantom) {
      window.open("https://phantom.com/download", "_blank", "noopener,noreferrer");
      setError("Install Phantom to use Live Devnet mode.");
      return;
    }

    setConnecting(true);
    try {
      if (address) {
        await provider.disconnect();
        setAddress(null);
        return;
      }
      const connection = await provider.connect();
      setAddress(connection.publicKey.toString());
    } catch (cause) {
      const rejected = typeof cause === "object" && cause !== null && "code" in cause && cause.code === 4001;
      setError(rejected ? "Wallet connection was cancelled." : "Phantom could not complete the connection.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="wallet-control">
      <button className="button button-small" disabled={connecting} onClick={toggleWallet} type="button" aria-busy={connecting}>
        {connecting ? "Connecting…" : address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "Connect Phantom"}
      </button>
      {error && <span role="status">{error}</span>}
    </div>
  );
}
