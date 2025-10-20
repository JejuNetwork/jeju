import "server-only";
import { db } from "@/lib/data/db";
import { walletAddresses } from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";
import { getChainByChainId } from "@/lib/walletLinking/chainUtils";
import { WalletLinkingData } from "./readmeUtils";

/**
 * Retrieves user wallet data from the database.
 *
 * @param username The GitHub username
 * @returns A promise resolving to wallet linking data or null
 */
export async function getUserWalletData(
  username: string,
): Promise<WalletLinkingData | null> {
  const userWallets = await db.query.walletAddresses.findMany({
    where: and(
      eq(walletAddresses.userId, username),
      eq(walletAddresses.isActive, true),
    ),
    columns: {
      chainId: true,
      accountAddress: true,
      updatedAt: true,
    },
  });

  if (userWallets.length > 0) {
    const wallets = userWallets.map((wallet) => ({
      chain: getChainByChainId(wallet.chainId),
      address: wallet.accountAddress,
    }));

    const lastUpdated = userWallets.reduce((latest, wallet) => {
      const walletDate = new Date(wallet.updatedAt);
      return walletDate > latest ? walletDate : latest;
    }, new Date(0));

    return {
      wallets,
      lastUpdated: lastUpdated.toISOString(),
    };
  }

  return null;
}
