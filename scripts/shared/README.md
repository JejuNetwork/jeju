# Shared Utilities

Reusable utilities used across Jeju scripts.

## Modules

### App Discovery (`discover-apps.ts`)
**Unified manifest-based app discovery**

```typescript
import { 
  discoverAllApps,      // Discover all apps (core + vendor)
  discoverCoreApps,     // Discover core apps only
  discoverVendorApps,   // Discover vendor apps only
  getAutoStartApps,     // Get apps that auto-start
  displayAppsSummary,   // Show summary
  type JejuApp 
} from './shared/discover-apps';

const apps = discoverAllApps();
const autoStart = getAutoStartApps();
```

### Formatting (`format.ts`)
```typescript
import { formatETH, formatUSD, formatGas } from './shared/format';

formatETH('1000000000000000000') // "1.0000 ETH"
formatUSD(3245.67)                // "$3,245.67"
formatGas(150000)                 // "150.0K gas"
```

### Logging (`logger.ts`)
```typescript
import { Logger } from './shared/logger';

const logger = new Logger({ prefix: 'DEPLOY' });
logger.info('Starting...');
logger.success('Done!');
logger.error('Failed!');
```

### RPC (`rpc.ts`)
```typescript
import { FailoverProvider, checkRPC } from './shared/rpc';

const provider = new FailoverProvider([
  'https://rpc.jeju.network',
  'https://backup.jeju.network'
], 'Jeju');

const isHealthy = await checkRPC('http://localhost:9545');
```

### Notifications (`notifications.ts`)
```typescript
import { sendNotification, sendAlert } from './shared/notifications';

await sendNotification('Deployment complete', 'success');
await sendAlert('Critical error!');
```

### Bridge Helpers (`bridge-helpers.ts`)
```typescript
import { STANDARD_BRIDGE_ABI, OP_STACK_PREDEPLOYS } from './shared/bridge-helpers';

const bridgeAddress = OP_STACK_PREDEPLOYS.L2StandardBridge;
```

### Token Utils (`token-utils.ts`)
```typescript
import { 
  formatTokenAmount, 
  parseTokenAmount, 
  getTokenSymbol 
} from './shared/token-utils';

const formatted = formatTokenAmount(amount, 'USDC', 2);
const parsed = parseTokenAmount('100', 'USDC');
```

## Usage in Scripts

All shared utilities are designed to be used in deployment scripts, monitoring tools, and dev tooling.

Example deployment script:
```typescript
import { Logger } from './shared/logger';
import { FailoverProvider } from './shared/rpc';
import { sendSuccess } from './shared/notifications';

const logger = new Logger({ prefix: 'DEPLOY' });
const provider = new FailoverProvider(process.env.RPC_URL, 'Jeju');

logger.info('Deploying contracts...');
// ... deploy logic ...
logger.success('Deployed!');
await sendSuccess('Contracts deployed');
```

## Adding New Utilities

1. Create new file in `scripts/shared/`
2. Export functions/classes
3. Add to this README
4. Add tests in `<module>.test.ts`

## Testing

All utilities have comprehensive tests:
```bash
bun test scripts/shared/
```

