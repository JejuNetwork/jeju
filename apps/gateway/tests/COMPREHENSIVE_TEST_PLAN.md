# Gateway Portal - Comprehensive Test Plan
## Complete UX Flow Coverage with Synpress

**Goal**: Test EVERY user path, page, feature, modal, form, and transaction with actual blockchain interaction.

---

## 🎯 Test Coverage Matrix

### Main Dashboard Features

#### 1. **Homepage & Wallet Connection** ✅ PARTIAL
- [x] Display homepage without wallet
- [x] Show connect prompt
- [x] Connect MetaMask wallet via RainbowKit
- [x] Display wallet address in header
- [ ] **TODO**: Test disconnect wallet flow
- [ ] **TODO**: Test wallet switching (multiple accounts)
- [ ] **TODO**: Test network switching warnings
- [ ] **TODO**: Test connection errors (wrong network, rejected)
- [ ] **TODO**: Test reconnection after page refresh

#### 2. **Multi-Token Balance Display** ✅ PARTIAL
- [x] Display all 4 protocol tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
- [x] Show USD values for each token
- [x] Display token logos
- [x] Calculate total portfolio value
- [ ] **TODO**: Test balance updates after transactions
- [ ] **TODO**: Test zero balance display
- [ ] **TODO**: Test large number formatting (1M+, 1B+)
- [ ] **TODO**: Test logo fallback on error
- [ ] **TODO**: Test refresh functionality

---

### Tab 1: **Registered Tokens** ✅ PARTIAL

#### Token List View
- [x] Display list of registered tokens
- [x] Show token cards with details
- [x] Display paymaster status
- [ ] **TODO**: Test empty state (no tokens)
- [ ] **TODO**: Test refresh button
- [ ] **TODO**: Test token card interactions (click, hover)
- [ ] **TODO**: Test sorting/filtering tokens
- [ ] **TODO**: Test pagination if many tokens

#### Register New Token Form
- [x] Display registration form
- [x] Validate token address format
- [x] Validate fee ranges (0-500 bps)
- [x] Show registration fee
- [ ] **TODO**: Test actual token registration transaction
- [ ] **TODO**: Test form validation errors
- [ ] **TODO**: Test success message display
- [ ] **TODO**: Test auto-refresh after registration
- [ ] **TODO**: Test duplicate token registration (should fail)
- [ ] **TODO**: Test invalid oracle address
- [ ] **TODO**: Test min > max fee error
- [ ] **TODO**: Test insufficient balance for registration fee

---

### Tab 2: **Bridge from Ethereum** ✅ PARTIAL

#### Token Selection
- [x] Display bridge interface
- [x] Show elizaOS warning (native token)
- [x] Only show bridgeable tokens (CLANKER, VIRTUAL, CLANKERMON)
- [x] Allow custom token address input
- [x] Validate custom address format
- [ ] **TODO**: Test switching between "Select Token" and "Custom Address" modes
- [ ] **TODO**: Test loading token metadata for custom address
- [ ] **TODO**: Test invalid custom token address errors
- [ ] **TODO**: Test token not on Ethereum network error

#### Bridge Transaction
- [x] Validate amount input
- [x] Show USD value calculation
- [x] Optional recipient address
- [x] Display bridge information (time, bridge type)
- [ ] **TODO**: Test actual bridge transaction (approval + bridge)
- [ ] **TODO**: Test approval transaction separately
- [ ] **TODO**: Test bridge transaction after approval
- [ ] **TODO**: Test insufficient balance error
- [ ] **TODO**: Test insufficient allowance handling
- [ ] **TODO**: Test transaction rejection
- [ ] **TODO**: Test pending transaction status
- [ ] **TODO**: Test success message with tx hash
- [ ] **TODO**: Test bridge history update after transaction
- [ ] **TODO**: Test recipient address validation
- [ ] **TODO**: Test max amount button
- [ ] **TODO**: Test decimal precision handling

#### Bridge History
- [x] Display bridge history section
- [x] Show empty state
- [ ] **TODO**: Test populated history with real transfers
- [ ] **TODO**: Test status indicators (pending, confirmed, failed)
- [ ] **TODO**: Test timestamps display
- [ ] **TODO**: Test transaction hash links
- [ ] **TODO**: Test filtering by token
- [ ] **TODO**: Test pagination
- [ ] **TODO**: Test real-time updates

---

### Tab 3: **Deploy Paymaster** ✅ PARTIAL

#### Token Selection & Validation
- [x] Display deployment interface
- [x] Include ALL tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
- [x] Warn if token not registered
- [x] Warn if paymaster already deployed
- [x] Show fee margin slider
- [ ] **TODO**: Test token selection changes slider range
- [ ] **TODO**: Test registered vs unregistered token states
- [ ] **TODO**: Test already deployed token states (show addresses)

#### Deployment Transaction
- [x] Display deployment information (3 contracts)
- [x] Show cost estimate
- [ ] **TODO**: Test actual deployment transaction
- [ ] **TODO**: Test deployment progress tracking
- [ ] **TODO**: Test success message with contract addresses
- [ ] **TODO**: Test deployment failure handling
- [ ] **TODO**: Test transaction rejection
- [ ] **TODO**: Test gas estimation
- [ ] **TODO**: Test deployment for each token (elizaOS, CLANKER, VIRTUAL, CLANKERMON)
- [ ] **TODO**: Test verify deployed contracts are correct addresses
- [ ] **TODO**: Test UI update after deployment (show addresses)
- [ ] **TODO**: Test navigation to "Add Liquidity" after deployment

---

### Tab 4: **Add Liquidity** ✅ PARTIAL

#### Liquidity Interface
- [x] Display add liquidity interface
- [x] Show info box (how it works)
- [x] Include all protocol tokens
- [x] Warn if paymaster not deployed
- [x] Validate ETH amount input
- [ ] **TODO**: Test actual add liquidity transaction
- [ ] **TODO**: Test ETH amount validation (min, max, decimals)
- [ ] **TODO**: Test insufficient balance error
- [ ] **TODO**: Test transaction rejection
- [ ] **TODO**: Test success message
- [ ] **TODO**: Test LP position update after adding
- [ ] **TODO**: Test max button (use all ETH)
- [ ] **TODO**: Test gas reserve calculation

#### LP Position Display
- [x] Display LP position if exists
- [x] Show ETH shares, value, pending fees
- [x] Show remove liquidity button
- [ ] **TODO**: Test position updates in real-time
- [ ] **TODO**: Test remove liquidity transaction
- [ ] **TODO**: Test partial vs full removal
- [ ] **TODO**: Test slippage protection
- [ ] **TODO**: Test position refresh after add/remove
- [ ] **TODO**: Test multiple positions (different tokens)
- [ ] **TODO**: Test position value calculations accuracy

---

### Tab 5: **My Earnings (LP Dashboard)** ✅ PARTIAL

#### LP Positions Overview
- [x] Display LP dashboard
- [x] Show positions for all tokens with liquidity
- [x] Show empty state if no positions
- [x] Display claim button for pending fees
- [ ] **TODO**: Test claim fees transaction for each token
- [ ] **TODO**: Test claim success message
- [ ] **TODO**: Test pending fees update after claim
- [ ] **TODO**: Test multiple position management
- [ ] **TODO**: Test earnings calculations accuracy
- [ ] **TODO**: Test APY/APR display (if implemented)
- [ ] **TODO**: Test historical earnings chart
- [ ] **TODO**: Test fee accumulation over time
- [ ] **TODO**: Test position sorting/filtering

---

### Tab 6: **Node Operators** ✅ PARTIAL

#### Network Overview Section
- [x] Display network statistics
- [x] Show total nodes, staked value, rewards claimed
- [x] Display operator ownership meter
- [x] Show ownership warnings
- [ ] **TODO**: Test stats update in real-time
- [ ] **TODO**: Test ownership percentage calculations
- [ ] **TODO**: Test near-limit warnings (>16% ownership)
- [ ] **TODO**: Test at-limit blocking (20% ownership)
- [ ] **TODO**: Test geographic distribution charts
- [ ] **TODO**: Test token distribution breakdown

#### My Nodes Section
- [x] Display my nodes list
- [x] Show node cards with details
- [x] Display performance metrics
- [x] Show claim and deregister buttons
- [ ] **TODO**: Test empty state (no nodes)
- [ ] **TODO**: Test node card expansion/collapse
- [ ] **TODO**: Test performance metrics updates
- [ ] **TODO**: Test claim rewards transaction for each node
- [ ] **TODO**: Test deregister transaction (after 7 days)
- [ ] **TODO**: Test deregister blocked (before 7 days)
- [ ] **TODO**: Test slashed node display
- [ ] **TODO**: Test inactive node handling
- [ ] **TODO**: Test uptime score accuracy
- [ ] **TODO**: Test response time display
- [ ] **TODO**: Test requests served counter

#### Register New Node Form
- [x] Display registration form
- [x] Staking token selector (all tokens)
- [x] Reward token selector (can differ)
- [x] Validate minimum stake ($1000 USD)
- [x] Calculate USD value
- [x] RPC URL input
- [x] Geographic region selector
- [x] Show bonus for underserved regions
- [x] Show staking requirements
- [x] Estimate monthly rewards
- [x] Enforce max 5 nodes per operator
- [ ] **TODO**: Test actual node registration transaction
- [ ] **TODO**: Test registration for each token combination
- [ ] **TODO**: Test stake amount < $1000 rejection
- [ ] **TODO**: Test RPC URL validation
- [ ] **TODO**: Test RPC URL connectivity check (pre-registration)
- [ ] **TODO**: Test region selection changes bonus display
- [ ] **TODO**: Test reward estimation for each token
- [ ] **TODO**: Test max nodes warning (at 5 nodes)
- [ ] **TODO**: Test registration blocked at max nodes
- [ ] **TODO**: Test form reset after success
- [ ] **TODO**: Test insufficient balance for stake
- [ ] **TODO**: Test token approval before staking (ERC20)

---

### Tab 7: **App Registry** ✅ PARTIAL

#### Browse Apps Section
- [x] Display registered apps list
- [x] Show tag filters
- [x] Filter by tag
- [x] Display app cards
- [x] Show A2A enabled badge
- [x] Show refresh button
- [ ] **TODO**: Test empty state (no apps)
- [ ] **TODO**: Test tag filter switching
- [ ] **TODO**: Test "All Apps" filter
- [ ] **TODO**: Test app card click opens modal
- [ ] **TODO**: Test refresh button functionality
- [ ] **TODO**: Test pagination (if many apps)
- [ ] **TODO**: Test search functionality
- [ ] **TODO**: Test sorting (by date, stake, etc)

#### App Detail Modal
- [x] Display app details modal
- [x] Show owner actions if owner
- [ ] **TODO**: Test modal open animation
- [ ] **TODO**: Test modal close (X button, ESC key, outside click)
- [ ] **TODO**: Test A2A endpoint link
- [ ] **TODO**: Test evidence/metadata display
- [ ] **TODO**: Test owner-only actions visible
- [ ] **TODO**: Test withdraw stake transaction (owner only)
- [ ] **TODO**: Test edit details button (if implemented)
- [ ] **TODO**: Test non-owner view (no actions)
- [ ] **TODO**: Test keyboard navigation
- [ ] **TODO**: Test mobile responsive modal

#### Register App Form
- [x] Display registration form
- [x] Required app name field
- [x] Optional description field
- [x] Optional A2A endpoint field
- [x] Tag selection (multiple)
- [x] Stake token selector
- [x] Calculate required stake
- [x] Form validation
- [ ] **TODO**: Test actual app registration transaction
- [ ] **TODO**: Test token approval before registration
- [ ] **TODO**: Test registration success
- [ ] **TODO**: Test registration failure handling
- [ ] **TODO**: Test form validation for each field
- [ ] **TODO**: Test tag limit (max 10 tags)
- [ ] **TODO**: Test stake calculation for each token
- [ ] **TODO**: Test A2A endpoint validation
- [ ] **TODO**: Test description character limit
- [ ] **TODO**: Test name uniqueness check
- [ ] **TODO**: Test form reset after success
- [ ] **TODO**: Test insufficient balance error
- [ ] **TODO**: Test auto-navigation after registration

---

## 📍 Additional Pages/Routes (Currently Untested)

### `/moderation` - Moderation Dashboard
- [ ] **TODO**: Navigate to moderation page
- [ ] **TODO**: Test active reports tab
- [ ] **TODO**: Test resolved reports tab
- [ ] **TODO**: Test submit report tab
- [ ] **TODO**: Test report cards display
- [ ] **TODO**: Test report filtering
- [ ] **TODO**: Test report voting interface
- [ ] **TODO**: Test evidence upload
- [ ] **TODO**: Test submit report transaction
- [ ] **TODO**: Test vote on report transaction
- [ ] **TODO**: Test report status updates
- [ ] **TODO**: Test ban execution
- [ ] **TODO**: Test appeal submission
- [ ] **TODO**: Test guardian voting

### `/storage` - Storage Manager
- [ ] **TODO**: Navigate to storage page
- [ ] **TODO**: Test upload files tab
- [ ] **TODO**: Test my files tab
- [ ] **TODO**: Test funding tab
- [ ] **TODO**: Test file upload to IPFS
- [ ] **TODO**: Test duration selection (1mo, 6mo, 12mo)
- [ ] **TODO**: Test price calculation
- [ ] **TODO**: Test file list display
- [ ] **TODO**: Test file expiration warnings
- [ ] **TODO**: Test renew file transaction
- [ ] **TODO**: Test fund storage balance
- [ ] **TODO**: Test payment token selection (USDC, elizaOS)
- [ ] **TODO**: Test x402 payment flow
- [ ] **TODO**: Test storage quota tracking

### `/agent/[id]` - Agent Profile Page
- [ ] **TODO**: Navigate to agent profile
- [ ] **TODO**: Test agent info display
- [ ] **TODO**: Test reputation viewer
- [ ] **TODO**: Test ban status display
- [ ] **TODO**: Test labels display
- [ ] **TODO**: Test reports against agent
- [ ] **TODO**: Test activity stats
- [ ] **TODO**: Test report button
- [ ] **TODO**: Test appeal button (if banned)
- [ ] **TODO**: Test stake info display

---

## 🔄 Complete User Flows (End-to-End)

### Flow 1: **Complete Token Lifecycle**
- [ ] **TODO**: Connect wallet
- [ ] **TODO**: Register new token (transaction)
- [ ] **TODO**: Verify token appears in list
- [ ] **TODO**: Deploy paymaster for token (transaction)
- [ ] **TODO**: Verify paymaster deployed
- [ ] **TODO**: Add ETH liquidity (transaction)
- [ ] **TODO**: Verify LP position created
- [ ] **TODO**: Wait for fees to accumulate
- [ ] **TODO**: Claim fees (transaction)
- [ ] **TODO**: Verify fees received
- [ ] **TODO**: Remove liquidity (transaction)
- [ ] **TODO**: Verify position removed

### Flow 2: **Complete Bridge Flow**
- [ ] **TODO**: Connect wallet
- [ ] **TODO**: Select CLANKER token
- [ ] **TODO**: Enter amount (100 CLANKER)
- [ ] **TODO**: Enter recipient address
- [ ] **TODO**: Approve CLANKER for bridge (transaction)
- [ ] **TODO**: Verify approval success
- [ ] **TODO**: Execute bridge transaction
- [ ] **TODO**: Verify bridge success message
- [ ] **TODO**: Check balance updated on Jeju
- [ ] **TODO**: Verify bridge history entry

### Flow 3: **Complete Node Staking Flow**
- [ ] **TODO**: Connect wallet
- [ ] **TODO**: Navigate to Node Operators
- [ ] **TODO**: View network overview stats
- [ ] **TODO**: Click Register New Node
- [ ] **TODO**: Select elizaOS as staking token
- [ ] **TODO**: Enter stake amount (10,000 elizaOS = $1000)
- [ ] **TODO**: Select CLANKER as reward token
- [ ] **TODO**: Enter RPC URL
- [ ] **TODO**: Select Africa region (for +50% bonus)
- [ ] **TODO**: Verify USD value >= $1000
- [ ] **TODO**: Verify reward estimate displayed
- [ ] **TODO**: Approve elizaOS for staking (transaction)
- [ ] **TODO**: Execute register node transaction
- [ ] **TODO**: Verify success message
- [ ] **TODO**: Navigate to My Nodes
- [ ] **TODO**: Verify node appears in list
- [ ] **TODO**: Verify node details displayed
- [ ] **TODO**: Wait for pending rewards to accumulate
- [ ] **TODO**: Click claim rewards
- [ ] **TODO**: Execute claim transaction
- [ ] **TODO**: Verify rewards received in CLANKER
- [ ] **TODO**: Wait 7 days (or fast-forward time)
- [ ] **TODO**: Click deregister
- [ ] **TODO**: Execute deregister transaction
- [ ] **TODO**: Verify stake refunded
- [ ] **TODO**: Verify node removed from list

### Flow 4: **Complete App Registry Flow**
- [ ] **TODO**: Connect wallet
- [ ] **TODO**: Navigate to App Registry
- [ ] **TODO**: Browse apps, filter by tag
- [ ] **TODO**: Click on app card
- [ ] **TODO**: Verify modal opens with details
- [ ] **TODO**: Close modal
- [ ] **TODO**: Click Register App
- [ ] **TODO**: Fill app name
- [ ] **TODO**: Fill description
- [ ] **TODO**: Enter A2A endpoint URL
- [ ] **TODO**: Select tags (Game, Social)
- [ ] **TODO**: Select VIRTUAL as stake token
- [ ] **TODO**: Verify required stake calculated
- [ ] **TODO**: Approve VIRTUAL for staking (transaction)
- [ ] **TODO**: Execute register app transaction
- [ ] **TODO**: Verify success message
- [ ] **TODO**: Verify app appears in browse list
- [ ] **TODO**: Click on newly registered app
- [ ] **TODO**: Verify owner actions visible
- [ ] **TODO**: Test edit details
- [ ] **TODO**: Test withdraw stake transaction
- [ ] **TODO**: Verify stake refunded
- [ ] **TODO**: Verify app removed from list

### Flow 5: **Complete Moderation Flow**
- [ ] **TODO**: Navigate to /moderation
- [ ] **TODO**: View active reports
- [ ] **TODO**: Click Submit Report tab
- [ ] **TODO**: Enter target agent ID
- [ ] **TODO**: Select report type (Network Ban)
- [ ] **TODO**: Select severity (High)
- [ ] **TODO**: Upload evidence file to IPFS
- [ ] **TODO**: Verify evidence hash displayed
- [ ] **TODO**: Enter report details
- [ ] **TODO**: Verify bond amount (0.05 ETH for High)
- [ ] **TODO**: Submit report transaction
- [ ] **TODO**: Verify report created
- [ ] **TODO**: View report in active reports list
- [ ] **TODO**: Click Vote button
- [ ] **TODO**: View futarchy market prices
- [ ] **TODO**: Vote YES (ban) with 0.1 ETH
- [ ] **TODO**: Execute vote transaction
- [ ] **TODO**: Verify vote recorded
- [ ] **TODO**: Wait for voting period to end
- [ ] **TODO**: Execute ban if YES wins
- [ ] **TODO**: Verify ban applied
- [ ] **TODO**: Test appeal submission (if banned)
- [ ] **TODO**: Test guardian review process

### Flow 6: **Complete Governance Flow**
- [ ] **TODO**: View voting power breakdown
- [ ] **TODO**: Create governance quest
- [ ] **TODO**: Fill quest title and objective
- [ ] **TODO**: Select prize token
- [ ] **TODO**: Enter prize amount
- [ ] **TODO**: Submit create quest transaction
- [ ] **TODO**: Verify quest created
- [ ] **TODO**: View quest markets
- [ ] **TODO**: Trade on YES market
- [ ] **TODO**: Trade on NO market
- [ ] **TODO**: Wait for voting period
- [ ] **TODO**: Verify outcome
- [ ] **TODO**: Execute change if YES wins
- [ ] **TODO**: Verify parameter changed on-chain

### Flow 7: **Complete Storage Flow**
- [ ] **TODO**: Navigate to /storage
- [ ] **TODO**: Select file to upload
- [ ] **TODO**: Choose storage duration (6 months)
- [ ] **TODO**: Verify price calculation
- [ ] **TODO**: Upload file to Jeju IPFS
- [ ] **TODO**: Verify CID returned
- [ ] **TODO**: Pin file on-chain transaction
- [ ] **TODO**: Verify file in My Files list
- [ ] **TODO**: View file via IPFS gateway
- [ ] **TODO**: Test file expiration warning
- [ ] **TODO**: Renew file storage
- [ ] **TODO**: Fund storage balance
- [ ] **TODO**: Test payment processing

---

## 🎨 UI State Testing

### Token Selector Component
- [x] Display token dropdown
- [x] Show token logos
- [x] Show balances
- [x] Show prices
- [ ] **TODO**: Test dropdown open/close
- [ ] **TODO**: Test keyboard navigation (arrow keys)
- [ ] **TODO**: Test search/filter in dropdown
- [ ] **TODO**: Test disabled state
- [ ] **TODO**: Test loading state
- [ ] **TODO**: Test empty state (no tokens)

### Loading States
- [ ] **TODO**: Test skeleton loaders for balances
- [ ] **TODO**: Test spinner for transactions
- [ ] **TODO**: Test progress bars
- [ ] **TODO**: Test "Loading..." text displays
- [ ] **TODO**: Test disabled buttons during loading

### Error States
- [ ] **TODO**: Test contract read errors
- [ ] **TODO**: Test contract write errors
- [ ] **TODO**: Test network errors
- [ ] **TODO**: Test insufficient balance errors
- [ ] **TODO**: Test validation errors
- [ ] **TODO**: Test timeout errors
- [ ] **TODO**: Test error message display
- [ ] **TODO**: Test error recovery (retry buttons)

### Success States
- [ ] **TODO**: Test success messages for all transactions
- [ ] **TODO**: Test success animations
- [ ] **TODO**: Test auto-dismiss after delay
- [ ] **TODO**: Test navigation after success
- [ ] **TODO**: Test data refresh after success

---

## 🔐 Transaction Testing

### For EVERY transaction type:

#### Token Registration
- [ ] **TODO**: Test with insufficient ETH for fee
- [ ] **TODO**: Test with invalid token address
- [ ] **TODO**: Test transaction rejected by user
- [ ] **TODO**: Test transaction pending state
- [ ] **TODO**: Test transaction confirmed
- [ ] **TODO**: Test transaction failed
- [ ] **TODO**: Test gas estimation

#### Paymaster Deployment
- [ ] **TODO**: Test deployment transaction
- [ ] **TODO**: Test verify all 3 contracts deployed
- [ ] **TODO**: Test deployment failure handling
- [ ] **TODO**: Test gas limit issues

#### Add Liquidity (ETH)
- [ ] **TODO**: Test add liquidity transaction
- [ ] **TODO**: Test with various amounts (0.1, 1, 10 ETH)
- [ ] **TODO**: Test max ETH (leave gas reserve)
- [ ] **TODO**: Test shares calculation

#### Remove Liquidity
- [ ] **TODO**: Test remove partial liquidity
- [ ] **TODO**: Test remove all liquidity
- [ ] **TODO**: Test slippage protection
- [ ] **TODO**: Test ETH received calculation

#### Claim Fees
- [ ] **TODO**: Test claim LP fees for each token
- [ ] **TODO**: Test claim node rewards for each token
- [ ] **TODO**: Test claim with zero pending (should fail)
- [ ] **TODO**: Test claim all at once

#### Node Registration
- [ ] **TODO**: Test with ERC20 stake (approval + register)
- [ ] **TODO**: Test with different stake amounts
- [ ] **TODO**: Test with each reward token
- [ ] **TODO**: Test with each region

#### App Registration  
- [ ] **TODO**: Test with ERC20 stake (approval + register)
- [ ] **TODO**: Test with various stake tokens
- [ ] **TODO**: Test with/without A2A endpoint
- [ ] **TODO**: Test with multiple tags

#### Bridge Transactions
- [ ] **TODO**: Test approve for each token
- [ ] **TODO**: Test bridge for each token
- [ ] **TODO**: Test with custom token
- [ ] **TODO**: Test with recipient address
- [ ] **TODO**: Test bridge tracking

---

## 🧪 Multi-Token Equality Testing

### For EACH token (elizaOS, CLANKER, VIRTUAL, CLANKERMON):
- [ ] **TODO**: Display in balance view with correct price
- [ ] **TODO**: Available in all dropdowns (where appropriate)
- [ ] **TODO**: Bridge flow works (exclude elizaOS)
- [ ] **TODO**: Paymaster deployment works
- [ ] **TODO**: Add liquidity works
- [ ] **TODO**: Claim fees works
- [ ] **TODO**: Node staking works (as staking token)
- [ ] **TODO**: Node rewards work (as reward token)
- [ ] **TODO**: App registry stake works
- [ ] **TODO**: Storage payment works
- [ ] **TODO**: Governance prize works

---

## 🎭 Modal & Popup Testing

### Modals
- [ ] **TODO**: App Detail Modal (open, close, interactions)
- [ ] **TODO**: Transaction Confirmation Modal
- [ ] **TODO**: Error Modal
- [ ] **TODO**: Connect Wallet Modal (RainbowKit)
- [ ] **TODO**: Network Switch Modal

### Toasts/Notifications
- [ ] **TODO**: Success toasts for all transactions
- [ ] **TODO**: Error toasts for failures
- [ ] **TODO**: Warning toasts for validations
- [ ] **TODO**: Info toasts for guidance
- [ ] **TODO**: Auto-dismiss behavior
- [ ] **TODO**: Manual dismiss

---

## 🧭 Navigation Testing

### Tab Navigation
- [x] All 7 main tabs clickable
- [x] Wallet connection persists across tabs
- [ ] **TODO**: Test active tab highlighting
- [ ] **TODO**: Test browser back/forward buttons
- [ ] **TODO**: Test deep linking to specific tabs
- [ ] **TODO**: Test mobile navigation (hamburger menu)

### Sub-Navigation
- [ ] **TODO**: Node Operators: Overview → My Nodes → Register
- [ ] **TODO**: App Registry: Browse → Register
- [ ] **TODO**: Token Registry: List → Register form
- [ ] **TODO**: Moderation: Active → Resolved → Submit

### External Navigation
- [ ] **TODO**: Links to block explorer
- [ ] **TODO**: Links to IPFS gateway
- [ ] **TODO**: Links to A2A endpoints
- [ ] **TODO**: Links to documentation

---

## 📱 Responsive & Accessibility

### Mobile Testing
- [ ] **TODO**: Test mobile layout for all pages
- [ ] **TODO**: Test touch interactions
- [ ] **TODO**: Test mobile navigation menu
- [ ] **TODO**: Test modal behavior on mobile
- [ ] **TODO**: Test form inputs on mobile

### Keyboard Navigation
- [ ] **TODO**: Test tab key navigation
- [ ] **TODO**: Test enter key submissions
- [ ] **TODO**: Test escape key for modals
- [ ] **TODO**: Test arrow keys in dropdowns

### Screen Reader
- [ ] **TODO**: Test ARIA labels
- [ ] **TODO**: Test semantic HTML
- [ ] **TODO**: Test focus management

---

## ⚡ Performance Testing

- [ ] **TODO**: Test initial page load time
- [ ] **TODO**: Test time to interactive
- [ ] **TODO**: Test balance loading time
- [ ] **TODO**: Test contract read batching
- [ ] **TODO**: Test image lazy loading
- [ ] **TODO**: Test component rendering performance

---

## 🔒 Security Testing

- [ ] **TODO**: Test XSS prevention in user inputs
- [ ] **TODO**: Test CSRF token handling
- [ ] **TODO**: Test signature validation
- [ ] **TODO**: Test nonce management
- [ ] **TODO**: Test unauthorized access to owner actions

---

## 🎪 Edge Cases

### Wallet States
- [ ] **TODO**: No wallet extension installed
- [ ] **TODO**: Wallet locked
- [ ] **TODO**: Wrong network
- [ ] **TODO**: No ETH balance
- [ ] **TODO**: No token balance
- [ ] **TODO**: Pending transactions

### Data States
- [ ] **TODO**: Empty lists (no tokens, no nodes, no apps)
- [ ] **TODO**: Single item lists
- [ ] **TODO**: Large lists (100+ items)
- [ ] **TODO**: Zero balances
- [ ] **TODO**: Very large balances (1B+)
- [ ] **TODO**: Very small balances (0.000001)

### Network States
- [ ] **TODO**: RPC not responding
- [ ] **TODO**: Slow RPC responses
- [ ] **TODO**: Contract not deployed
- [ ] **TODO**: Contract reverted
- [ ] **TODO**: Gas price spikes
- [ ] **TODO**: Nonce conflicts

---

## 📊 Test Implementation Priority

### Phase 1: Critical Flows (Week 1)
1. Complete token lifecycle (register → deploy → LP → claim)
2. Complete bridge flow (approve → bridge → verify)
3. Complete node flow (register → monitor → claim → deregister)
4. Complete app registry flow (register → view → withdraw)

### Phase 2: Feature Coverage (Week 2)
1. All transaction types tested
2. All validation tested
3. All error states tested
4. All success states tested

### Phase 3: Polish (Week 3)
1. Moderation features
2. Storage features
3. Governance features
4. Edge cases
5. Mobile responsive
6. Accessibility

---

## 🎯 Success Criteria

✅ **100% UX Coverage**: Every user-facing feature tested  
✅ **100% Transaction Coverage**: Every transaction type tested  
✅ **100% Navigation Coverage**: Every route and tab tested  
✅ **100% Component Coverage**: Every component tested  
✅ **All Multi-Token**: All 4 tokens tested equally  
✅ **Real Blockchain**: All tests run against live localnet  
✅ **Screenshots**: Every flow documented with screenshots  
✅ **CI/CD Ready**: Tests run in automated pipeline  

---

## 📝 Test File Structure (To Be Created)

```
tests/synpress/
├── flows/
│   ├── 01-complete-token-lifecycle.spec.ts       ⚠️ TODO
│   ├── 02-complete-bridge-flow.spec.ts           ⚠️ TODO
│   ├── 03-complete-node-flow.spec.ts             ⚠️ TODO
│   ├── 04-complete-app-registry-flow.spec.ts     ⚠️ TODO
│   ├── 05-complete-moderation-flow.spec.ts       ⚠️ TODO
│   ├── 06-complete-governance-flow.spec.ts       ⚠️ TODO
│   └── 07-complete-storage-flow.spec.ts          ⚠️ TODO
├── features/
│   ├── wallet-connection.spec.ts                 ✅ EXISTS (needs enhancement)
│   ├── token-registry.spec.ts                    ✅ EXISTS (needs transactions)
│   ├── bridge-tokens.spec.ts                     ✅ EXISTS (needs transactions)
│   ├── deploy-paymaster.spec.ts                  ✅ EXISTS (needs transactions)
│   ├── add-liquidity.spec.ts                     ✅ EXISTS (needs transactions)
│   ├── node-staking.spec.ts                      ✅ EXISTS (needs transactions)
│   ├── app-registry.spec.ts                      ✅ EXISTS (needs transactions)
│   ├── lp-dashboard.spec.ts                      ⚠️ TODO (claim fees)
│   ├── moderation-dashboard.spec.ts              ⚠️ TODO
│   ├── storage-manager.spec.ts                   ⚠️ TODO
│   ├── agent-profile.spec.ts                     ⚠️ TODO
│   └── governance-quests.spec.ts                 ⚠️ TODO
├── components/
│   ├── token-selector.spec.ts                    ⚠️ TODO
│   ├── multi-token-balance.spec.ts               ⚠️ TODO
│   ├── token-list.spec.ts                        ⚠️ TODO
│   ├── network-stats.spec.ts                     ⚠️ TODO
│   ├── my-nodes-card.spec.ts                     ⚠️ TODO
│   └── registered-apps-list.spec.ts              ⚠️ TODO
├── transactions/
│   ├── token-registration.spec.ts                ⚠️ TODO
│   ├── paymaster-deployment.spec.ts              ⚠️ TODO
│   ├── liquidity-operations.spec.ts              ⚠️ TODO
│   ├── node-operations.spec.ts                   ⚠️ TODO
│   ├── app-registration.spec.ts                  ⚠️ TODO
│   ├── bridge-operations.spec.ts                 ⚠️ TODO
│   ├── moderation-operations.spec.ts             ⚠️ TODO
│   └── governance-operations.spec.ts             ⚠️ TODO
├── navigation/
│   ├── tab-switching.spec.ts                     ⚠️ TODO
│   ├── modal-navigation.spec.ts                  ⚠️ TODO
│   ├── page-routing.spec.ts                      ⚠️ TODO
│   └── deep-linking.spec.ts                      ⚠️ TODO
├── edge-cases/
│   ├── wallet-states.spec.ts                     ⚠️ TODO
│   ├── empty-states.spec.ts                      ⚠️ TODO
│   ├── error-handling.spec.ts                    ⚠️ TODO
│   ├── large-datasets.spec.ts                    ⚠️ TODO
│   └── network-issues.spec.ts                    ⚠️ TODO
└── multi-token/
    ├── elizaos-equality.spec.ts                  ⚠️ TODO
    ├── clanker-equality.spec.ts                  ⚠️ TODO
    ├── virtual-equality.spec.ts                  ⚠️ TODO
    └── clankermon-equality.spec.ts               ⚠️ TODO
```

---

## 🚀 Execution Strategy

### Local Development
```bash
# Start full environment
bun run dev                      # Localnet + Gateway UI + A2A server

# Run test suites
bun run test:synpress:flows      # Critical flows
bun run test:synpress:features   # Feature coverage
bun run test:synpress:txs        # Transaction testing
bun run test:synpress:all        # Everything
```

### CI/CD Pipeline
```yaml
- Deploy contracts to localnet
- Start Gateway services
- Run Synpress tests in headless mode
- Capture screenshots on failure
- Generate coverage report
- Upload artifacts
```

---

## 📈 Coverage Metrics

| Category | Current | Target | Status |
|----------|---------|--------|--------|
| **Main Tabs** | 70% | 100% | 🟡 In Progress |
| **Sub-Sections** | 40% | 100% | 🔴 Needs Work |
| **Transactions** | 0% | 100% | 🔴 Critical |
| **Modals** | 20% | 100% | 🔴 Needs Work |
| **Forms** | 60% | 100% | 🟡 In Progress |
| **Navigation** | 80% | 100% | 🟢 Nearly Done |
| **Multi-Token** | 50% | 100% | 🟡 In Progress |
| **Error States** | 10% | 100% | 🔴 Critical |
| **Edge Cases** | 5% | 100% | 🔴 Needs Work |
| **OVERALL** | **35%** | **100%** | 🔴 **65% TO GO** |

---

## ⚠️ CRITICAL GAPS

1. **NO TRANSACTION TESTS**: All current tests are UI-only, no actual blockchain transactions tested
2. **Missing Pages**: Moderation, Storage, Agent Profile completely untested
3. **No Error Testing**: Error states and edge cases not covered
4. **No Complete Flows**: End-to-end flows not tested (start to finish)
5. **Limited Multi-Token**: Only balance display tested, not all features

---

## ✅ Next Actions

1. **Create comprehensive transaction tests** (flows/ directory)
2. **Add missing page tests** (moderation, storage, agent profile)
3. **Implement error state testing** (edge-cases/ directory)
4. **Complete multi-token equality** (test all features with all tokens)
5. **Add navigation and modal tests** (navigation/ directory)



