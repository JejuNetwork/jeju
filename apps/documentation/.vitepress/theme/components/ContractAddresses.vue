<script setup lang="ts">
import { data as chainConfigs } from '../../data/chainConfig.data';
import { ref } from 'vue';

interface Props {
  network: 'mainnet' | 'testnet';
  layer: 'l1' | 'l2';
}

const props = defineProps<Props>();

const config = chainConfigs[props.network];
const contracts = config.contracts[props.layer];

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
};

const getExplorerLink = (address: string) => {
  if (props.layer === 'l2') {
    return `${config.explorerUrl}/address/${address}`;
  } else {
    return `${config.l1RpcUrl.replace('https://', 'https://').replace('.org', 'scan.org')}/address/${address}`;
  }
};
</script>

<template>
  <div class="contract-addresses">
    <div v-for="(address, name) in contracts" :key="name" class="contract-row">
      <div class="contract-info">
        <span class="contract-name">{{ name }}:</span>
        <code class="contract-address" v-if="address">{{ address }}</code>
        <code class="contract-address empty" v-else>TBD (will be set on deployment)</code>
      </div>
      <div class="contract-actions" v-if="address">
        <button @click="copyToClipboard(address)" class="copy-button" title="Copy address">
          Copy
        </button>
        <a :href="getExplorerLink(address)" target="_blank" class="explorer-link" title="View on explorer">
          Explorer
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contract-addresses {
  margin: 1rem 0;
}

.contract-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  margin: 0.5rem 0;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  gap: 1rem;
}

.contract-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.contract-name {
  font-weight: 600;
  white-space: nowrap;
  color: var(--vp-c-text-1);
}

.contract-address {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
  background: var(--vp-c-bg);
  border-radius: 4px;
  word-break: break-all;
  flex: 1;
}

.contract-address.empty {
  color: var(--vp-c-text-3);
  font-style: italic;
}

.contract-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.copy-button,
.explorer-link {
  padding: 0.375rem 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-decoration: none;
  white-space: nowrap;
}

.copy-button {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-dark);
  border: 1px solid var(--vp-c-brand);
}

.copy-button:hover {
  background: var(--vp-c-brand);
  color: white;
}

.explorer-link {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-divider);
}

.explorer-link:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
}

@media (max-width: 768px) {
  .contract-row {
    flex-direction: column;
    align-items: stretch;
  }

  .contract-info {
    flex-direction: column;
    align-items: stretch;
  }

  .contract-actions {
    width: 100%;
  }

  .copy-button,
  .explorer-link {
    flex: 1;
  }
}
</style>


