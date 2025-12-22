#!/usr/bin/env bun
/**
 * Populate test data for Grafana dashboards
 * Creates realistic blockchain data for monitoring visualization
 */

import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  host: 'localhost',
  port: 23798,
  user: 'postgres',
  password: 'postgres',
  database: 'indexer',
});

async function populateTestData(): Promise<void> {
  const client: PoolClient = await pool.connect();
  
  console.log('🚀 Starting test data population...\n');

  // Create test accounts
  console.log('📝 Creating accounts...');
  const accounts: string[] = [];
  for (let i = 0; i < 20; i++) {
    const address = `0x${i.toString(16).padStart(40, '0')}`;
    await client.query(`
      INSERT INTO account (id, address, is_contract, first_seen_block, last_seen_block, 
                         transaction_count, total_value_sent, total_value_received, labels, 
                         first_seen_at, last_seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING
    `, [
      `account-${i}`,
      address,
      i < 5,
      1,
      100 + i,
      10 + i,
      1000000 + i * 100000,
      2000000 + i * 150000,
      `{user-${i}}`,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      new Date(),
    ]);
    accounts.push(`account-${i}`);
  }
  console.log(`✅ Created ${accounts.length} accounts\n`);

  // Create blocks
  console.log('📦 Creating blocks...');
  const blocks: string[] = [];
  for (let i = 1; i <= 100; i++) {
    const blockId = `block-${i}`;
    await client.query(`
      INSERT INTO block (id, number, hash, parent_hash, timestamp, transaction_count, 
                       gas_used, gas_limit, base_fee_per_gas, size, miner_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING
    `, [
      blockId,
      i,
      `0x${i.toString(16).padStart(64, '0')}`,
      `0x${(i - 1).toString(16).padStart(64, '0')}`,
      new Date(Date.now() - (100 - i) * 12 * 1000),
      Math.floor(Math.random() * 20) + 1,
      BigInt(Math.floor(Math.random() * 8000000) + 2000000),
      BigInt(30000000),
      BigInt(Math.floor(Math.random() * 50) + 10),
      Math.floor(Math.random() * 50000) + 10000,
      accounts[i % 5],
    ]);
    blocks.push(blockId);
  }
  console.log(`✅ Created ${blocks.length} blocks\n`);

  // Create transactions
  console.log('💸 Creating transactions...');
  let txCount = 0;
  const transactions: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const numTxs = Math.floor(Math.random() * 15) + 1;
    for (let j = 0; j < numTxs; j++) {
      txCount++;
      const txId = `tx-${i}-${j}`;
      transactions.push(txId);
      await client.query(`
        INSERT INTO transaction (id, hash, block_number, transaction_index, value, gas_price,
                               gas_limit, gas_used, input, nonce, status, type,
                               from_id, to_id, block_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO NOTHING
      `, [
        txId,
        `0x${txCount.toString(16).padStart(64, '0')}`,
        i + 1,
        j,
        BigInt(Math.floor(Math.random() * 1000000)),
        BigInt(Math.floor(Math.random() * 100) + 20),
        BigInt(21000),
        BigInt(Math.floor(Math.random() * 21000)),
        '0x',
        j,
        Math.random() > 0.1 ? 'success' : 'failed',
        2,
        accounts[Math.floor(Math.random() * 15) + 5],
        accounts[Math.floor(Math.random() * 5)],
        blocks[i],
      ]);
    }
  }
  console.log(`✅ Created ${txCount} transactions\n`);

  // Create contracts
  console.log('📄 Creating contracts...');
  for (let i = 0; i < 5; i++) {
    await client.query(`
      INSERT INTO contract (id, address, bytecode, contract_type, is_erc20, is_erc721, 
                          is_erc1155, is_proxy, implementation_address, verified,
                          first_seen_at, last_seen_at, creator_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO NOTHING
    `, [
      `contract-${i}`,
      `0x${i.toString(16).padStart(40, '0')}`,
      `0x${i.toString(16).repeat(100)}`,
      ['ERC20', 'ERC721', 'ERC1155', 'DEFI', 'GAME'][i],
      i === 0,
      i === 1,
      i === 2,
      false,
      null,
      i < 3,
      new Date(Date.now() - 48 * 60 * 60 * 1000),
      new Date(),
      accounts[10 + i],
    ]);
  }
  console.log(`✅ Created 5 contracts\n`);

  // Create token transfers
  console.log('🔄 Creating token transfers...');
  const numTransfers = Math.min(50, transactions.length);
  for (let i = 0; i < numTransfers; i++) {
    const isNFT = i % 3 !== 0;
    await client.query(`
      INSERT INTO token_transfer (id, log_index, token_standard, value, token_id, timestamp,
                                 from_id, to_id, block_id, transaction_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO NOTHING
    `, [
      `transfer-${i}`,
      i % 10,
      ['ERC20', 'ERC721', 'ERC1155'][i % 3],
      isNFT ? null : BigInt(Math.floor(Math.random() * 1000000)),
      isNFT ? `contract-${i % 5}` : null,
      new Date(Date.now() - (numTransfers - i) * 30 * 1000),
      accounts[Math.floor(Math.random() * 10) + 5],
      accounts[Math.floor(Math.random() * 10) + 5],
      blocks[Math.floor(i * blocks.length / numTransfers)],
      transactions[i],
    ]);
  }
  console.log(`✅ Created ${numTransfers} token transfers\n`);

  // Create prediction markets
  console.log('🎯 Creating prediction markets...');
  for (let i = 0; i < 10; i++) {
    await client.query(`
      INSERT INTO prediction_market (id, session_id, question, liquidity_b, yes_shares, 
                                    no_shares, total_volume, created_at, resolved, outcome)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO NOTHING
    `, [
      `market-${i}`,
      `session-${i}`,
      `Will event ${i} happen?`,
      BigInt(10000),
      BigInt(Math.floor(Math.random() * 5000) + 2000),
      BigInt(Math.floor(Math.random() * 5000) + 2000),
      BigInt(Math.floor(Math.random() * 50000) + 10000),
      new Date(Date.now() - (10 - i) * 60 * 60 * 1000),
      i < 3,
      i < 3 ? Math.random() > 0.5 : null,
    ]);
  }
  console.log(`✅ Created 10 prediction markets\n`);

  // Create market trades
  console.log('📈 Creating market trades...');
  for (let i = 0; i < 30; i++) {
    await client.query(`
      INSERT INTO market_trade (id, outcome, is_buy, shares, cost, price_after, timestamp,
                               market_id, trader_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `, [
      `trade-${i}`,
      Math.random() > 0.5,
      Math.random() > 0.5,
      BigInt(Math.floor(Math.random() * 1000) + 100),
      BigInt(Math.floor(Math.random() * 500) + 50),
      BigInt(Math.floor(Math.random() * 100) + 40),
      new Date(Date.now() - (30 - i) * 60 * 1000),
      `market-${i % 10}`,
      accounts[Math.floor(Math.random() * 10) + 5],
    ]);
  }
  console.log(`✅ Created 30 market trades\n`);

  // Create decoded events
  console.log('📋 Creating decoded events...');
  const numEvents = Math.min(100, transactions.length);
  for (let i = 0; i < numEvents; i++) {
    await client.query(`
      INSERT INTO decoded_event (id, event_signature, event_name, args, timestamp,
                                address_id, block_id, transaction_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `, [
      `event-${i}`,
      `Transfer(address,address,uint256)`,
      ['Transfer', 'Approval', 'Swap', 'Mint', 'Burn'][i % 5],
      JSON.stringify({ from: accounts[i % 10], to: accounts[(i + 1) % 10], value: i * 1000 }),
      new Date(Date.now() - (numEvents - i) * 30 * 1000),
      accounts[i % 5],
      blocks[Math.floor(i * blocks.length / numEvents)],
      transactions[i],
    ]);
  }
  console.log(`✅ Created ${numEvents} decoded events\n`);

  console.log('✅ Test data population complete!\n');
  console.log('📊 Summary:');
  console.log(`   - ${accounts.length} accounts`);
  console.log(`   - ${blocks.length} blocks`);
  console.log(`   - ${txCount} transactions`);
  console.log(`   - 5 contracts`);
  console.log(`   - ${numTransfers} token transfers`);
  console.log(`   - 10 prediction markets`);
  console.log(`   - 30 market trades`);
  console.log(`   - ${numEvents} decoded events`);

  client.release();
  await pool.end();
}

// Run if called directly
if (import.meta.main) {
  populateTestData().catch((error: Error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { populateTestData };
