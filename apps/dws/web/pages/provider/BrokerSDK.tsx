import {
  ArrowRight,
  Cloud,
  Code2,
  Cpu,
  DollarSign,
  ExternalLink,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  Server,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react'

const BROKER_FEATURES = [
  {
    icon: <Cloud size={24} />,
    title: 'External Compute Sources',
    description:
      'Connect AWS, GCP, Lambda Labs, or any compute provider. List their resources on the DWS marketplace without owning the hardware.',
  },
  {
    icon: <DollarSign size={24} />,
    title: 'Pay-Per-Use',
    description:
      'Only pay for compute when users rent it. No upfront costs. Set your markup and earn on every transaction.',
  },
  {
    icon: <Shield size={24} />,
    title: 'Trustless Settlement',
    description:
      'All payments flow through smart contracts. Automatic splitting between you, the provider, and the network.',
  },
  {
    icon: <Zap size={24} />,
    title: 'On-Demand Provisioning',
    description:
      'Resources are provisioned only when rented. Consumers connect directly to compute, you handle billing.',
  },
]

const INTEGRATION_EXAMPLES = [
  {
    name: 'AWS EC2',
    description: 'Broker spot instances and on-demand compute',
    icon: <Cloud size={20} />,
    status: 'available',
  },
  {
    name: 'Google Cloud',
    description: 'Offer GCP compute to DWS users',
    icon: <Globe size={20} />,
    status: 'available',
  },
  {
    name: 'Lambda Labs',
    description: 'GPU compute for AI/ML workloads',
    icon: <Cpu size={20} />,
    status: 'available',
  },
  {
    name: 'Hetzner',
    description: 'Affordable dedicated servers',
    icon: <Server size={20} />,
    status: 'available',
  },
  {
    name: 'Bass.ai',
    description: 'AI-optimized inference compute',
    icon: <Layers size={20} />,
    status: 'coming',
  },
  {
    name: 'Custom Provider',
    description: 'Build your own adapter for any provider',
    icon: <Code2 size={20} />,
    status: 'available',
  },
]

const API_EXAMPLE = `import { DWSBroker } from '@jejunetwork/broker-sdk'

// Initialize the broker with your credentials
const broker = new DWSBroker({
  privateKey: process.env.BROKER_PRIVATE_KEY,
  network: 'mainnet',
})

// Register your compute source
await broker.registerSource({
  name: 'My AWS Account',
  type: 'aws-ec2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'us-east-1',
  },
  // Define what instances you want to offer
  offerings: [
    {
      instanceType: 't3.medium',
      pricePerHour: '0.05', // Your markup price in USDC
      maxInstances: 10,
    },
    {
      instanceType: 'g4dn.xlarge',
      pricePerHour: '0.80',
      maxInstances: 5,
    },
  ],
})

// List available resources on the marketplace
await broker.syncListings()

// Handle incoming rental requests
broker.on('rental:request', async (request) => {
  // Provision the instance from your source
  const instance = await broker.provision(request)
  
  // Return connection details to the consumer
  return {
    instanceId: instance.id,
    endpoint: instance.publicIp,
    credentials: instance.sshKey,
  }
})

// Start the broker
await broker.start()`

const WEBHOOK_EXAMPLE = `// Webhook handler for rental lifecycle events
app.post('/webhook/dws', async (req, res) => {
  const { event, data } = req.body
  
  switch (event) {
    case 'rental.created':
      // Provision resources from your provider
      await provisionFromAWS(data.instanceType, data.region)
      break
      
    case 'rental.extended':
      // Handle rental extensions
      await extendInstance(data.instanceId, data.newDuration)
      break
      
    case 'rental.ended':
      // Clean up resources
      await terminateInstance(data.instanceId)
      break
  }
  
  res.json({ ok: true })
})`

export default function BrokerSDKPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Broker SDK</h1>
          <p className="page-subtitle">
            Connect external compute sources to the DWS marketplace. Earn by
            brokering resources without owning hardware.
          </p>
        </div>
      </div>

      {/* Hero Section */}
      <div
        className="card"
        style={{
          background:
            'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, var(--bg-elevated) 100%)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '2rem',
            alignItems: 'center',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: '1.75rem',
                fontWeight: 700,
                marginBottom: '0.75rem',
              }}
            >
              Become a Compute Broker
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '1.5rem',
                maxWidth: '500px',
              }}
            >
              Connect your cloud accounts or data center to the DWS marketplace.
              List compute resources you don't own, provision on-demand, and
              earn a commission on every rental.
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <a
                href="https://github.com/jejunetwork/broker-sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ padding: '0.875rem 1.5rem' }}
              >
                <GitBranch size={18} /> View on GitHub
              </a>
              <a
                href="#quick-start"
                className="btn btn-secondary"
                style={{ padding: '0.875rem 1.5rem' }}
              >
                <Terminal size={18} /> Quick Start
              </a>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '1.5rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-lg)',
              minWidth: '160px',
            }}
          >
            <Code2 size={32} style={{ color: 'rgb(139, 92, 246)' }} />
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'rgb(139, 92, 246)',
              }}
            >
              SDK v2.0
            </div>
            <div
              style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}
            >
              TypeScript / Node.js
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Layers size={18} /> How Brokering Works
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '1rem',
            position: 'relative',
          }}
        >
          <Step
            number={1}
            title="Register"
            description="Sign up as a broker and connect your cloud provider credentials"
          />
          <Step
            number={2}
            title="List"
            description="Define what compute you want to offer and set your markup price"
          />
          <Step
            number={3}
            title="Provision"
            description="When users rent, provision from your cloud and provide access"
          />
          <Step
            number={4}
            title="Earn"
            description="Collect payments automatically. You keep your margin."
          />
        </div>
      </div>

      {/* Features Grid */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Zap size={18} /> Key Features
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {BROKER_FEATURES.map((feature) => (
            <div
              key={feature.title}
              style={{
                padding: '1.25rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  padding: '0.75rem',
                  background: 'rgba(139, 92, 246, 0.15)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'rgb(139, 92, 246)',
                  marginBottom: '1rem',
                }}
              >
                {feature.icon}
              </div>
              <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                {feature.title}
              </h4>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.9rem',
                  lineHeight: 1.5,
                }}
              >
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Integration Examples */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Globe size={18} /> Supported Providers
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          {INTEGRATION_EXAMPLES.map((integration) => (
            <div
              key={integration.name}
              style={{
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
              }}
            >
              <div
                style={{
                  padding: '0.5rem',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                }}
              >
                {integration.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.25rem',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{integration.name}</span>
                  <span
                    className={`badge ${integration.status === 'available' ? 'badge-success' : 'badge-warning'}`}
                    style={{ fontSize: '0.7rem' }}
                  >
                    {integration.status === 'available' ? 'Ready' : 'Coming'}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    margin: 0,
                  }}
                >
                  {integration.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Start */}
      <div id="quick-start" className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <Terminal size={18} /> Quick Start
          </h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Install the broker SDK and start listing compute in minutes:
        </p>
        <div
          style={{
            background: 'var(--bg-tertiary)',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            # Install the SDK
          </div>
          <div style={{ color: 'var(--accent)' }}>
            bun add @jejunetwork/broker-sdk
          </div>
        </div>

        <h4 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>
          Basic Setup
        </h4>
        <div
          style={{
            background: '#1e1e2e',
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            overflow: 'auto',
            maxHeight: '500px',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              lineHeight: 1.6,
              color: '#cdd6f4',
            }}
          >
            <code>{API_EXAMPLE}</code>
          </pre>
        </div>
      </div>

      {/* Webhook Integration */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <GitBranch size={18} /> Webhook Integration
          </h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Handle rental lifecycle events with webhooks:
        </p>
        <div
          style={{
            background: '#1e1e2e',
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            overflow: 'auto',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              lineHeight: 1.6,
              color: '#cdd6f4',
            }}
          >
            <code>{WEBHOOK_EXAMPLE}</code>
          </pre>
        </div>
      </div>

      {/* Revenue Model */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header">
          <h3 className="card-title">
            <DollarSign size={18} /> Revenue Model
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1.5rem',
          }}
        >
          <RevenueCard
            title="Your Margin"
            percentage="70-90%"
            description="Set your own markup above provider costs"
            highlight
          />
          <RevenueCard
            title="Network Fee"
            percentage="5%"
            description="Goes to DWS network treasury"
          />
          <RevenueCard
            title="Protocol Fee"
            percentage="5%"
            description="Distributed to JEJU stakers"
          />
        </div>
        <div
          style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Example Calculation
          </h4>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
              margin: 0,
            }}
          >
            AWS g4dn.xlarge costs you $0.50/hr. You list at $0.80/hr. User rents
            for 10 hours = $8.00. After fees (~10%), you keep{' '}
            <strong style={{ color: 'var(--success)' }}>$2.20 profit</strong>{' '}
            per rental.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <h3 style={{ marginBottom: '0.75rem' }}>Ready to Start Brokering?</h3>
        <p
          style={{
            color: 'var(--text-secondary)',
            marginBottom: '1.5rem',
            maxWidth: '500px',
            margin: '0 auto 1.5rem',
          }}
        >
          Join the compute marketplace and start earning commissions on cloud
          resources today.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
          <a
            href="https://github.com/jejunetwork/broker-sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            <GitBranch size={18} /> View Documentation{' '}
            <ExternalLink size={14} />
          </a>
          <a href="/marketplace/browse" className="btn btn-secondary">
            <HardDrive size={18} /> Browse Marketplace <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </div>
  )
}

function Step({
  number,
  title,
  description,
}: {
  number: number
  title: string
  description: string
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background:
            'linear-gradient(135deg, rgb(139, 92, 246), rgb(168, 85, 247))',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: '1.25rem',
          margin: '0 auto 0.75rem',
        }}
      >
        {number}
      </div>
      <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{title}</h4>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: '0.85rem',
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
    </div>
  )
}

function RevenueCard({
  title,
  percentage,
  description,
  highlight,
}: {
  title: string
  percentage: string
  description: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        padding: '1.5rem',
        background: highlight ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-md)',
        border: highlight ? '1px solid var(--success)' : undefined,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '2rem',
          fontWeight: 700,
          color: highlight ? 'var(--success)' : 'var(--text)',
          marginBottom: '0.5rem',
        }}
      >
        {percentage}
      </div>
      <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{title}</h4>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: '0.85rem',
          margin: 0,
        }}
      >
        {description}
      </p>
    </div>
  )
}
