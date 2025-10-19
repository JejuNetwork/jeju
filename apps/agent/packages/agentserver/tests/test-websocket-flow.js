import { WebSocket } from 'ws';

console.log('🧪 Testing WebSocket message flow...\n');

// The actual agent ID for ELIZA calculated from stringToUuid('ELIZA')
const ELIZA_AGENT_ID = '2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f';

const ws = new WebSocket('ws://localhost:7777/ws');

ws.on('open', () => {
  console.log('✅ Connected to WebSocket server');

  // Send initial connection message
  const connectMsg = {
    type: 'connect',
    agent_id: ELIZA_AGENT_ID,
    channel_id: 'test-channel-123',
    client_type: 'test_client',
  };

  console.log('📤 Sending connection message:', connectMsg);
  ws.send(JSON.stringify(connectMsg));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📨 Received:', message);

  // After receiving connection ack, send a test message
  if (message.type === 'connection_ack') {
    console.log('\n🔗 Connection acknowledged, sending test message...');

    const testMsg = {
      type: 'message',
      content: 'Hello ELIZA, can you hear me?',
      author: 'TestUser',
      channel_id: 'test-channel-123',
      agent_id: ELIZA_AGENT_ID,
      timestamp: Date.now(),
    };

    console.log('📤 Sending test message:', testMsg);
    ws.send(JSON.stringify(testMsg));
  } else if (message.type === 'message_ack') {
    console.log('\n✅ Message acknowledged by server');
    console.log('⏳ Waiting for agent response...');
  } else if (message.type === 'agent_message' || message.type === 'agent_response') {
    console.log('\n🤖 AGENT RESPONSE RECEIVED!');
    console.log('Content:', message.content);
    if (message.thought) {
      console.log('Thought:', message.thought);
    }
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 WebSocket connection closed');
});

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n❌ Test timed out - no agent response received within 30 seconds');
  process.exit(1);
}, 30000);
