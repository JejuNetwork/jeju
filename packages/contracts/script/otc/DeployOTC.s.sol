// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {OTC} from "../../src/otc/OTC.sol";
import {MockERC20} from "../../src/otc/mocks/MockERC20.sol";
import {MockAggregatorV3} from "../../src/otc/mocks/MockAggregator.sol";
import {IAggregatorV3} from "../../src/otc/interfaces/IAggregatorV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployOTC
/// @notice Deployment script for OTC contracts in localnet/testnet
contract DeployOTC is Script {
    function run() external {
        // Get deployer from env or use default anvil account
        uint256 deployerPrivateKey =
            vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));

        address owner = vm.addr(deployerPrivateKey);

        // Use anvil default accounts
        address agent = vm.addr(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);
        address approver = vm.addr(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a);

        console.log("Deploying OTC System...");
        console.log("Owner:", owner);
        console.log("Agent:", agent);
        console.log("Approver:", approver);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Token
        console.log("\n1. Deploying Token...");
        MockERC20 token = new MockERC20(
            "elizaOS",
            "elizaOS",
            18,
            100_000_000 * 10 ** 18 // 100M tokens
        );
        console.log("Token:", address(token));

        // 2. Deploy USDC Mock
        console.log("\n2. Deploying USDC Mock...");
        MockERC20 usdcToken = new MockERC20(
            "USD Coin",
            "USDC",
            6,
            10_000_000 * 10 ** 6 // 10M USDC
        );
        console.log("USDC:", address(usdcToken));

        // 3. Deploy Price Feeds
        console.log("\n3. Deploying Price Feeds...");
        MockAggregatorV3 tokenUsdFeed = new MockAggregatorV3(8, 5_000_000); // $0.05
        console.log("Token/USD Feed:", address(tokenUsdFeed));

        MockAggregatorV3 ethUsdFeed = new MockAggregatorV3(8, 3_500_00000000); // $3500
        console.log("ETH/USD Feed:", address(ethUsdFeed));

        // 4. Deploy OTC Contract
        console.log("\n4. Deploying OTC Contract...");
        OTC otc = new OTC(owner, IERC20(address(usdcToken)), IAggregatorV3(address(ethUsdFeed)), agent);
        console.log("OTC Contract:", address(otc));

        // 5. Configure OTC Contract
        console.log("\n5. Configuring OTC Contract...");
        otc.setApprover(approver, true);
        console.log("Approver set:", approver);

        otc.setLimits(
            500_000_000, // $5 min
            1_000_000 * 10 ** 18, // 1M tokens max
            30 * 60, // 30 min expiry
            0 // No default lockup
        );
        console.log("Limits configured");

        otc.setRequireApproverToFulfill(true);
        console.log("Approver-only fulfillment enabled");

        // 6. Register token and create consignment
        console.log("\n6. Setting up consignment...");
        bytes32 tokenId = keccak256("elizaOS");
        otc.registerToken(tokenId, address(token), address(tokenUsdFeed));
        console.log("Token registered");

        uint256 fundAmount = 10_000_000 * 10 ** 18; // 10M tokens
        uint256 gasDeposit = 0.001 ether;
        token.approve(address(otc), fundAmount);

        // createConsignment params: tokenId, amount, isNegotiable, fixedDiscountBps, fixedLockupDays,
        //   minDiscountBps, maxDiscountBps, minLockupDays, maxLockupDays, minDealAmount, maxDealAmount, maxPriceVolatilityBps
        otc.createConsignment{value: gasDeposit}(
            tokenId,
            fundAmount,
            true, // negotiable
            0, // fixedDiscountBps
            0, // fixedLockupDays
            100, // minDiscountBps (1%)
            2500, // maxDiscountBps (25%)
            7, // minLockupDays
            365, // maxLockupDays
            100 * 10 ** 18, // min 100 tokens
            1_000_000 * 10 ** 18, // max 1M tokens
            2000 // maxPriceVolatilityBps (20%)
        );
        console.log("Consignment created with 10M tokens");

        // 7. Fund test accounts
        console.log("\n7. Funding test accounts...");
        usdcToken.transfer(agent, 100_000 * 10 ** 6); // 100k USDC to agent
        console.log("Agent funded with 100,000 USDC");

        // Create test wallet
        uint256 testWalletKey = uint256(keccak256(abi.encodePacked(block.timestamp, "test")));
        address testWallet = vm.addr(testWalletKey);

        payable(testWallet).transfer(0.001 ether);
        usdcToken.transfer(testWallet, 10_000 * 10 ** 6); // 10k USDC
        otc.setApprover(testWallet, true);
        console.log("Test wallet created and funded:", testWallet);

        vm.stopBroadcast();

        // 8. Write deployment info
        console.log("\n8. Writing deployment info...");
        string memory deploymentJson = string.concat(
            "{\n",
            '  "network": "anvil",\n',
            '  "timestamp": "',
            vm.toString(block.timestamp),
            '",\n',
            '  "contracts": {\n',
            '    "token": "',
            vm.toString(address(token)),
            '",\n',
            '    "usdcToken": "',
            vm.toString(address(usdcToken)),
            '",\n',
            '    "otc": "',
            vm.toString(address(otc)),
            '",\n',
            '    "tokenUsdFeed": "',
            vm.toString(address(tokenUsdFeed)),
            '",\n',
            '    "ethUsdFeed": "',
            vm.toString(address(ethUsdFeed)),
            '"\n',
            "  },\n",
            '  "accounts": {\n',
            '    "owner": "',
            vm.toString(owner),
            '",\n',
            '    "agent": "',
            vm.toString(agent),
            '",\n',
            '    "approver": "',
            vm.toString(approver),
            '",\n',
            '    "testWallet": "',
            vm.toString(testWallet),
            '"\n',
            "  },\n",
            '  "testWalletPrivateKey": "',
            vm.toString(testWalletKey),
            '"\n',
            "}"
        );

        vm.writeFile("deployments/otc-local.json", deploymentJson);

        console.log("\nDEPLOYMENT SUCCESSFUL");
        console.log("======================================");
        console.log("Token:", address(token));
        console.log("OTC Contract:", address(otc));
        console.log("Test Wallet:", testWallet);
        console.log("======================================");
    }
}
