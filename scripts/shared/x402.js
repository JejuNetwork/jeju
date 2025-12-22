"use strict";
/**
 * Shared x402 Payment Protocol Implementation
 *
 * Shared x402 library for all network apps (bazaar, gateway, compute, storage, cloud)
 * Implements Coinbase x402 specification with EIP-712 signatures
 *
 * @see https://x402.org
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_TIERS = exports.USDC_ADDRESSES = exports.RPC_URLS = exports.CHAIN_IDS = void 0;
exports.createPaymentRequirement = createPaymentRequirement;
exports.getEIP712Domain = getEIP712Domain;
exports.getEIP712Types = getEIP712Types;
exports.createPaymentPayload = createPaymentPayload;
exports.parsePaymentHeader = parsePaymentHeader;
exports.verifyPayment = verifyPayment;
exports.signPaymentPayload = signPaymentPayload;
exports.checkPayment = checkPayment;
exports.calculatePercentageFee = calculatePercentageFee;
exports.generate402Headers = generate402Headers;
const viem_1 = require("viem");
// ============ Network Configuration ============
exports.CHAIN_IDS = {
    sepolia: 11155111,
    'base-sepolia': 84532,
    ethereum: 1,
    base: 8453,
    jeju: 420691,
    'jeju-testnet': 420690,
};
exports.RPC_URLS = {
    sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
    'base-sepolia': 'https://sepolia.base.org',
    ethereum: 'https://eth.llamarpc.com',
    base: 'https://mainnet.base.org',
    jeju: process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
    'jeju-testnet': process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
};
// USDC addresses per network
exports.USDC_ADDRESSES = {
    sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    jeju: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    'jeju-testnet': '0x0000000000000000000000000000000000000000',
};
// ============ Payment Tiers (used across all apps) ============
exports.PAYMENT_TIERS = {
    // API Access
    API_CALL_BASIC: (0, viem_1.parseEther)('0.0001'),
    API_CALL_PREMIUM: (0, viem_1.parseEther)('0.001'),
    API_DAILY_ACCESS: (0, viem_1.parseEther)('0.1'),
    API_MONTHLY_ACCESS: (0, viem_1.parseEther)('2.0'),
    // Compute Services
    COMPUTE_INFERENCE: (0, viem_1.parseEther)('0.0005'),
    COMPUTE_HOURLY: (0, viem_1.parseEther)('0.05'),
    COMPUTE_GPU_HOURLY: (0, viem_1.parseEther)('0.5'),
    // Storage
    STORAGE_PER_GB_MONTH: (0, viem_1.parseEther)('0.001'),
    STORAGE_RETRIEVAL: (0, viem_1.parseEther)('0.0001'),
    // Marketplace
    NFT_LISTING: (0, viem_1.parseEther)('0.001'),
    NFT_PURCHASE_FEE_BPS: 250, // 2.5%
    SWAP_FEE_BPS: 30, // 0.3%
    POOL_CREATION: (0, viem_1.parseEther)('0.01'),
    // Games
    GAME_ENTRY: (0, viem_1.parseEther)('0.01'),
    GAME_PREMIUM: (0, viem_1.parseEther)('0.05'),
    BET_PLACEMENT: (0, viem_1.parseEther)('0.001'),
    MARKET_CREATION: (0, viem_1.parseEther)('0.02'),
};
// ============ EIP-712 Configuration ============
const EIP712_DOMAIN_BASE = {
    name: 'x402 Payment Protocol',
    version: '1',
    verifyingContract: '0x0000000000000000000000000000000000000000',
};
const EIP712_TYPES = {
    Payment: [
        { name: 'scheme', type: 'string' },
        { name: 'network', type: 'string' },
        { name: 'asset', type: 'address' },
        { name: 'payTo', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'resource', type: 'string' },
        { name: 'nonce', type: 'string' },
        { name: 'timestamp', type: 'uint256' },
    ],
};
// ============ Core Functions ============
/**
 * Create a 402 Payment Required response
 */
function createPaymentRequirement(resource, amount, description, config, tokenAddress = '0x0000000000000000000000000000000000000000') {
    return {
        x402Version: 1,
        error: 'Payment required to access this resource',
        accepts: [{
                scheme: 'exact',
                network: config.network,
                maxAmountRequired: amount.toString(),
                asset: tokenAddress,
                payTo: config.recipientAddress,
                resource,
                description,
                mimeType: 'application/json',
                outputSchema: null,
                maxTimeoutSeconds: 300,
                extra: {
                    serviceName: config.serviceName,
                },
            }],
    };
}
/**
 * Get EIP-712 domain for a network
 */
function getEIP712Domain(network) {
    return {
        ...EIP712_DOMAIN_BASE,
        chainId: exports.CHAIN_IDS[network],
    };
}
/**
 * Get EIP-712 types for payment message
 */
function getEIP712Types() {
    return EIP712_TYPES;
}
/**
 * Generate cryptographically secure nonce
 */
function generateSecureNonce() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Create a payment payload ready for signing
 */
function createPaymentPayload(asset, payTo, amount, resource, network = 'sepolia') {
    return {
        scheme: 'exact',
        network,
        asset,
        payTo,
        amount: amount.toString(),
        resource,
        nonce: generateSecureNonce(),
        timestamp: Math.floor(Date.now() / 1000),
    };
}
/**
 * Parse x402 payment header from request
 */
function parsePaymentHeader(headerValue) {
    if (!headerValue)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(headerValue);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object')
        return null;
    return parsed;
}
/**
 * Verify payment with EIP-712 signature validation
 */
async function verifyPayment(payload, expectedAmount, expectedRecipient) {
    if (!payload.amount || !payload.payTo || !payload.asset) {
        return { valid: false, error: 'Missing required payment fields' };
    }
    const paymentAmount = BigInt(payload.amount);
    if (paymentAmount < expectedAmount) {
        return {
            valid: false,
            error: `Insufficient payment: ${(0, viem_1.formatEther)(paymentAmount)} < ${(0, viem_1.formatEther)(expectedAmount)} required`
        };
    }
    if (payload.payTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
        return { valid: false, error: `Invalid recipient: ${payload.payTo} !== ${expectedRecipient}` };
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - payload.timestamp) > 300) {
        return { valid: false, error: 'Payment timestamp expired' };
    }
    if (!payload.signature) {
        return { valid: false, error: 'Payment signature required' };
    }
    const { verifyTypedData, recoverTypedDataAddress } = await Promise.resolve().then(() => __importStar(require('viem')));
    const network = payload.network;
    const domain = getEIP712Domain(network);
    const message = {
        scheme: payload.scheme,
        network: payload.network,
        asset: payload.asset,
        payTo: payload.payTo,
        amount: BigInt(payload.amount),
        resource: payload.resource,
        nonce: payload.nonce,
        timestamp: BigInt(payload.timestamp),
    };
    const signer = await recoverTypedDataAddress({
        domain,
        types: EIP712_TYPES,
        primaryType: 'Payment',
        message,
        signature: payload.signature,
    });
    const isValid = await verifyTypedData({
        address: signer,
        domain,
        types: EIP712_TYPES,
        primaryType: 'Payment',
        message,
        signature: payload.signature,
    });
    if (!isValid) {
        return { valid: false, error: 'Invalid payment signature' };
    }
    return { valid: true, signer };
}
/**
 * Sign a payment payload using EIP-712
 */
async function signPaymentPayload(payload, privateKey) {
    const { privateKeyToAccount } = await Promise.resolve().then(() => __importStar(require('viem/accounts')));
    const account = privateKeyToAccount(privateKey);
    const network = payload.network;
    const domain = getEIP712Domain(network);
    const message = {
        scheme: payload.scheme,
        network: payload.network,
        asset: payload.asset,
        payTo: payload.payTo,
        amount: BigInt(payload.amount),
        resource: payload.resource,
        nonce: payload.nonce,
        timestamp: BigInt(payload.timestamp),
    };
    const signature = await account.signTypedData({
        domain,
        types: EIP712_TYPES,
        primaryType: 'Payment',
        message,
    });
    return { ...payload, signature };
}
/**
 * Check if request has valid x402 payment
 */
async function checkPayment(paymentHeader, requiredAmount, recipient) {
    const payment = parsePaymentHeader(paymentHeader);
    if (!payment) {
        return { paid: false, error: 'No payment header provided' };
    }
    const verification = await verifyPayment(payment, requiredAmount, recipient);
    if (!verification.valid) {
        return { paid: false, error: verification.error };
    }
    return { paid: true };
}
/**
 * Calculate percentage-based fee
 */
function calculatePercentageFee(amount, basisPoints) {
    return (amount * BigInt(basisPoints)) / BigInt(10000);
}
/**
 * Generate 402 response headers
 */
function generate402Headers(requirements) {
    return {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'x402',
        'X-Payment-Requirement': JSON.stringify(requirements),
        'Access-Control-Expose-Headers': 'X-Payment-Requirement, WWW-Authenticate',
    };
}
//# sourceMappingURL=x402.js.map