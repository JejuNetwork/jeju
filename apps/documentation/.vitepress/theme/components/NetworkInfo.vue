<script setup lang="ts">
import { data as chainConfigs } from '../../data/chainConfig.data';
import { computed } from 'vue';

interface Props {
  network: 'mainnet' | 'testnet';
}

const props = defineProps<Props>();

const config = computed(() => chainConfigs[props.network]);

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};
</script>

<template>
  <div class="network-info-card">
    <div class="info-row">
      <span class="label">Network Name:</span>
      <span class="value">{{ config.name }}</span>
    </div>

    <div class="info-row">
      <span class="label">Chain ID:</span>
      <span class="value">{{ config.chainId }}</span>
      <button @click="copyToClipboard(config.chainId.toString())" class="copy-button">
        Copy
      </button>
    </div>

    <div class="info-row">
      <span class="label">RPC URL:</span>
      <code class="value contract-address">{{ config.rpcUrl }}</code>
      <button @click="copyToClipboard(config.rpcUrl)" class="copy-button">
        Copy
      </button>
    </div>

    <div class="info-row">
      <span class="label">WebSocket:</span>
      <code class="value contract-address">{{ config.wsUrl }}</code>
      <button @click="copyToClipboard(config.wsUrl)" class="copy-button">
        Copy
      </button>
    </div>

    <div class="info-row">
      <span class="label">Explorer:</span>
      <a :href="config.explorerUrl" target="_blank" class="value link">
        {{ config.explorerUrl }}
      </a>
    </div>

    <div class="info-row">
      <span class="label">Settlement Layer:</span>
      <span class="value">{{ config.l1Name }} ({{ config.l1ChainId }})</span>
    </div>

    <div class="info-row">
      <span class="label">Block Time:</span>
      <span class="value">{{ config.blockTime / 1000 }}s ({{ config.flashblocksSubBlockTime }}ms sub-blocks)</span>
    </div>
  </div>
</template>

<style scoped>
.network-info-card {
  margin: 2rem 0;
  padding: 1.5rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
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
  color: var(--vp-c-text-1);
}

.value {
  flex: 1;
  word-break: break-all;
  color: var(--vp-c-text-2);
}

.value.link {
  color: var(--vp-c-brand);
  text-decoration: none;
}

.value.link:hover {
  text-decoration: underline;
}

.contract-address {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
  background: var(--vp-c-bg-soft);
  border-radius: 4px;
}

.copy-button {
  padding: 0.375rem 0.75rem;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-dark);
  border: 1px solid var(--vp-c-brand);
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.copy-button:hover {
  background: var(--vp-c-brand);
  color: white;
}

@media (max-width: 768px) {
  .info-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .label {
    min-width: auto;
  }

  .copy-button {
    align-self: flex-start;
  }
}
</style>


