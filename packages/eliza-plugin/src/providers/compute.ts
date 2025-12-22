/**
 * Compute Provider - Available compute resources context
 */

import {
  type IAgentRuntime,
  type Memory,
  type Provider,
  type ProviderResult,
  type State,
} from "@elizaos/core";
import { getNetworkName } from "@jejunetwork/config";
import { JEJU_SERVICE_NAME, type JejuService } from "../service";
import { validateProvider } from "../validation";

const networkName = getNetworkName();

export const jejuComputeProvider: Provider = {
  name: `${networkName}ComputeProvider`,

  async get(
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<ProviderResult> {
    const service = runtime.getService(JEJU_SERVICE_NAME) as
      | JejuService
      | undefined;

    if (!service) {
      return {
        text: `${networkName} compute not available`,
        data: {},
        values: {},
      };
    }

    const client = service.getClient();

    const providers = await client.compute.listProviders({
      gpuType: "NVIDIA_H100",
    });
    const myRentals = await client.compute.listMyRentals();
    const activeRentals = myRentals.filter(
      (r: { status: string }) => r.status === "ACTIVE",
    );

    const text = `Available GPU Providers: ${providers.length}
Active Rentals: ${activeRentals.length}
${providers
  .slice(0, 3)
  .map(
    (p: {
      name: string;
      address: string;
      resources?: { gpuType?: string; gpuCount?: number };
      pricing?: {
        pricePerHour?: bigint | number;
        pricePerHourFormatted?: string;
      };
    }) => {
      const validated = validateProvider(p);
      return `- ${validated.name}: ${validated.resources.gpuType} x${validated.resources.gpuCount} @ ${validated.pricing.pricePerHourFormatted ?? "N/A"} ETH/hr`;
    },
  )
  .join("\n")}`;

    return {
      text,
      data: {
        providers: providers.slice(0, 10),
        activeRentals,
      },
      values: {
        providerCount: providers.length.toString(),
        activeRentalCount: activeRentals.length.toString(),
      },
    };
  },
};
