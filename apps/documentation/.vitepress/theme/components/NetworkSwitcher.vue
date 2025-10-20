<script setup lang="ts">
import { ref, computed } from 'vue';

const currentNetwork = ref<'testnet' | 'mainnet'>('testnet');

const networkConfig = computed(() => {
  return currentNetwork.value === 'testnet' ? testnetConfig : mainnetConfig;
});

const testnetConfig = {
  chainId: 420690,
  name: 'Jeju Testnet',
  rpcUrl: 'https://testnet-rpc.jeju.network',
  wsUrl: 'wss://testnet-ws.jeju.network',
  explorerUrl: 'https://testnet-explorer.jeju.network',
  l1ChainId: 84532,
  l1Name: 'Base Sepolia',
  l1RpcUrl: 'https://sepolia.base.org',
};

const mainnetConfig = {
  chainId: 420691,
  name: 'Jeju Mainnet',
  rpcUrl: 'https://rpc.jeju.network',
  wsUrl: 'wss://ws.jeju.network',
  explorerUrl: 'https://explorer.jeju.network',
  l1ChainId: 8453,
  l1Name: 'Base',
  l1RpcUrl: 'https://mainnet.base.org',
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};
</script>

<template>
  <div class="network-switcher">
    <div class="switcher-buttons">
      <button 
        @click="currentNetwork = 'testnet'" 
        :class="{ active: currentNetwork === 'testnet' }"
        class="network-button testnet"
      >
        Testnet
      </button>
      <button 
        @click="currentNetwork = 'mainnet'" 
        :class="{ active: currentNetwork === 'mainnet' }"
        class="network-button mainnet"
      >
        Mainnet
      </button>
    </div>

    <div class="network-info">
      <h3>{{ networkConfig.name }}</h3>
      
      <div class="info-row">
        <span class="label">Chain ID:</span>
        <span class="value">{{ networkConfig.chainId }}</span>
        <button @click="copyToClipboard(networkConfig.chainId.toString())" class="copy-button">
          Copy
        </button>
      </div>

      <div class="info-row">
        <span class="label">RPC URL:</span>
        <span class="value contract-address">{{ networkConfig.rpcUrl }}</span>
        <button @click="copyToClipboard(networkConfig.rpcUrl)" class="copy-button">
          Copy
        </button>
      </div>

      <div class="info-row">
        <span class="label">WebSocket URL:</span>
        <span class="value contract-address">{{ networkConfig.wsUrl }}</span>
        <button @click="copyToClipboard(networkConfig.wsUrl)" class="copy-button">
          Copy
        </button>
      </div>

      <div class="info-row">
        <span class="label">Explorer:</span>
        <a :href="networkConfig.explorerUrl" target="_blank" class="value">
          {{ networkConfig.explorerUrl }}
        </a>
      </div>

      <div class="info-row">
        <span class="label">Settlement Layer:</span>
        <span class="value">{{ networkConfig.l1Name }} ({{ networkConfig.l1ChainId }})</span>
      </div>

      <div class="info-row">
        <span class="label">L1 RPC URL:</span>
        <span class="value contract-address">{{ networkConfig.l1RpcUrl }}</span>
        <button @click="copyToClipboard(networkConfig.l1RpcUrl)" class="copy-button">
          Copy
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.network-switcher {
  margin: 2rem 0;
  padding: 1.5rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.switcher-buttons {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.network-button {
  flex: 1;
  padding: 0.75rem 1.5rem;
  border: 2px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.network-button:hover {
  border-color: var(--vp-c-brand);
}

.network-button.active.testnet {
  background: #ffa50033;
  border-color: #ffa500;
  color: #ffa500;
}

.network-button.active.mainnet {
  background: #3eaf7c33;
  border-color: #3eaf7c;
  color: #3eaf7c;
}

.network-info h3 {
  margin-top: 0;
  margin-bottom: 1rem;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.75rem 0;
  padding: 0.5rem;
  background: var(--vp-c-bg);
  border-radius: 0.25rem;
}

.label {
  font-weight: 600;
  min-width: 140px;
}

.value {
  flex: 1;
  word-break: break-all;
}
</style>

