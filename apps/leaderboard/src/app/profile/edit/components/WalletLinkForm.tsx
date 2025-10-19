"use client";

import { useState, useEffect, FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Info, Shield, ArrowRight } from "lucide-react";
import { isAddress } from "viem"; // For ETH address validation
import { LinkedWallet } from "@/lib/walletLinking/readmeUtils";

interface WalletLinkFormProps {
  wallets: LinkedWallet[];
  onSubmit: (wallets: LinkedWallet[]) => Promise<void>;
  isProcessing: boolean;
}

// Basic regex for Solana address (Base58, 32-44 chars)
// For more robust validation, consider @solana/web3.js PublicKey.isOnCurve or similar
const SOL_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function WalletLinkForm({
  wallets = [],
  onSubmit,
  isProcessing,
}: WalletLinkFormProps) {
  const [ethAddress, setEthAddress] = useState("");
  const [solAddress, setSolAddress] = useState("");

  const [ethAddressError, setEthAddressError] = useState("");
  const [solAddressError, setSolAddressError] = useState("");

  const [isEthValid, setIsEthValid] = useState(true);
  const [isSolValid, setIsSolValid] = useState(true);

  // Initialize form with existing wallet addresses
  useEffect(() => {
    const ethWallet = wallets.find((w) => w.chain === "ethereum");
    const solWallet = wallets.find((w) => w.chain === "solana");

    setEthAddress(ethWallet?.address || "");
    setSolAddress(solWallet?.address || "");

    if (!ethWallet?.address || isAddress(ethWallet.address)) {
      setIsEthValid(true);
      setEthAddressError("");
    } else {
      setIsEthValid(false);
    }

    if (!solWallet?.address || SOL_ADDRESS_REGEX.test(solWallet.address)) {
      setIsSolValid(true);
      setSolAddressError("");
    } else {
      setIsSolValid(false);
    }
  }, [wallets]);

  useEffect(() => {
    if (ethAddress === "") {
      setIsEthValid(true);
      setEthAddressError("");
    } else {
      const isValid = isAddress(ethAddress);
      setIsEthValid(isValid);
      setEthAddressError(isValid ? "" : "Invalid Ethereum address.");
    }
  }, [ethAddress]);

  useEffect(() => {
    if (solAddress === "") {
      setIsSolValid(true);
      setSolAddressError("");
    } else {
      const isValid = SOL_ADDRESS_REGEX.test(solAddress);
      setIsSolValid(isValid);
      setSolAddressError(isValid ? "" : "Invalid Solana address format.");
    }
  }, [solAddress]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Double check validity before submitting
    if (!isEthValid || !isSolValid) {
      return;
    }

    const updatedWallets: LinkedWallet[] = [];

    if (ethAddress) {
      updatedWallets.push({
        chain: "ethereum",
        address: ethAddress,
      });
    }

    if (solAddress) {
      updatedWallets.push({
        chain: "solana",
        address: solAddress,
      });
    }

    await onSubmit(updatedWallets);
  };

  const hasValuesChanged =
    ethAddress !==
      (wallets.find((w) => w.chain === "ethereum")?.address || "") ||
    solAddress !== (wallets.find((w) => w.chain === "solana")?.address || "");
  const canSubmit =
    isEthValid && isSolValid && !isProcessing && hasValuesChanged;

  const isUpdateOperation = wallets.length > 0;
  const buttonTextBase = isUpdateOperation ? "Update" : "Save";
  const buttonText = isProcessing
    ? `${buttonTextBase === "Update" ? "Updating" : "Saving"}...`
    : `${buttonTextBase} Wallet Addresses`;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="ethAddress">Ethereum Address</Label>
        <Input
          id="ethAddress"
          type="text"
          value={ethAddress}
          onChange={(e) => setEthAddress(e.target.value)}
          placeholder="0x..."
          disabled={isProcessing}
          className={ethAddressError ? "border-destructive" : ""}
        />
        {ethAddressError && (
          <p className="text-sm text-destructive">{ethAddressError}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="solAddress">Solana Address</Label>
        <Input
          id="solAddress"
          type="text"
          value={solAddress}
          onChange={(e) => setSolAddress(e.target.value)}
          placeholder="Your Solana address (e.g., So1...)"
          disabled={isProcessing}
          className={solAddressError ? "border-destructive" : ""}
        />
        {solAddressError && (
          <p className="text-sm text-destructive">{solAddressError}</p>
        )}
      </div>
      <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
        {isProcessing ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        {buttonText}
      </Button>

      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-start space-x-2">
          <Info className="mt-0.5 h-4 w-4 text-primary" />
          <div className="space-y-1 text-xs">
            <p className="text-foreground">
              <span className="font-medium">Public addresses only:</span> Enter
              your wallet addresses to link them to your GitHub profile.
            </p>
            <div className="flex items-center space-x-1 text-muted-foreground">
              <Shield className="h-3 w-3" />
              <span>Never share private keys or seed phrases</span>
            </div>
            <div className="flex items-center space-x-1 text-muted-foreground">
              <ArrowRight className="h-3 w-3" />
              <span>Submit to generate README comment for copying</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
