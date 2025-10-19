/**
 * Service Browser Component
 * UI for discovering and connecting to ERC-8004 services
 */

import React, { useState, useEffect } from 'react';
import type { Service, ServiceFilters } from '../../../agentserver/src/erc8004/types';

type ServiceBrowserProps = {
  onConnect?: (serviceId: bigint) => void;
  agentId?: string;
};

export const ServiceBrowser: React.FC<ServiceBrowserProps> = ({ onConnect, agentId = 'default' }) => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<ServiceFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchServices = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      if (filter.type) params.append('type', filter.type);
      if (searchTerm) params.append('search', searchTerm);
      if (filter.minReputation) params.append('minReputation', filter.minReputation.toString());

      const response = await fetch(`/api/agents/${agentId}/erc8004/services?${params}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch services');
      }

      const data = await response.json();
      setServices(data.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, [filter, agentId]);

  const handleConnect = async (serviceId: bigint) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/erc8004/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: serviceId.toString() })
      });

      if (!response.ok) {
        throw new Error('Failed to connect');
      }

      onConnect?.(serviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  return (
    <div className="service-browser" style={styles.container}>
      <h2 style={styles.title}>ERC-8004 Service Discovery</h2>
      
      {/* Filters */}
      <div style={styles.filters}>
        <input
          type="text"
          placeholder="Search services..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && fetchServices()}
          style={styles.input}
        />
        
        <select
          value={filter.type || ''}
          onChange={(e) => setFilter({ ...filter, type: e.target.value as ServiceFilters['type'] })}
          style={styles.select}
        >
          <option value="">All Types</option>
          <option value="game">Games</option>
          <option value="tool">Tools</option>
          <option value="social">Social</option>
          <option value="defi">DeFi</option>
          <option value="content">Content</option>
        </select>

        <button onClick={fetchServices} style={styles.button} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      {/* Service List */}
      <div style={styles.serviceList}>
        {services.length === 0 && !loading && (
          <div style={styles.empty}>
            No services found. Try adjusting your filters.
          </div>
        )}

        {services.map((service) => (
          <div key={service.id.toString()} style={styles.serviceCard}>
            <div style={styles.serviceHeader}>
              <h3 style={styles.serviceName}>{service.name}</h3>
              <span style={styles.serviceType}>{service.type}</span>
            </div>

            <div style={styles.serviceBody}>
              {service.description && (
                <p style={styles.description}>{service.description}</p>
              )}

              <div style={styles.metadata}>
                <span style={styles.metadataItem}>
                  ID: {service.id.toString()}
                </span>
                
                {service.reputation && (
                  <span style={styles.metadataItem}>
                    ⭐ {service.reputation.score}/100 ({service.reputation.feedbackCount} reviews)
                  </span>
                )}
              </div>
            </div>

            <div style={styles.serviceFooter}>
              <button
                onClick={() => handleConnect(service.id)}
                style={styles.connectButton}
              >
                Connect
              </button>
              
              {service.url && (
                <a
                  href={service.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.linkButton}
                >
                  Visit
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Inline styles for simplicity
const styles = {
  container: {
    padding: '20px',
    maxWidth: '1200px',
    margin: '0 auto',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '20px',
    color: '#00ff00'
  },
  filters: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    flexWrap: 'wrap' as const
  },
  input: {
    flex: 1,
    minWidth: '200px',
    padding: '10px',
    border: '1px solid #00ff00',
    borderRadius: '4px',
    backgroundColor: '#000',
    color: '#00ff00',
    fontSize: '14px'
  },
  select: {
    padding: '10px',
    border: '1px solid #00ff00',
    borderRadius: '4px',
    backgroundColor: '#000',
    color: '#00ff00',
    fontSize: '14px'
  },
  button: {
    padding: '10px 20px',
    backgroundColor: '#00ff00',
    color: '#000',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    cursor: 'pointer'
  },
  error: {
    padding: '10px',
    backgroundColor: '#ff0000',
    color: '#fff',
    borderRadius: '4px',
    marginBottom: '20px'
  },
  serviceList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '20px'
  },
  empty: {
    textAlign: 'center' as const,
    padding: '40px',
    color: '#888',
    gridColumn: '1 / -1'
  },
  serviceCard: {
    border: '1px solid #00ff00',
    borderRadius: '8px',
    padding: '16px',
    backgroundColor: 'rgba(0, 255, 0, 0.05)',
    transition: 'transform 0.2s, box-shadow 0.2s'
  },
  serviceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  serviceName: {
    fontSize: '18px',
    fontWeight: 'bold' as const,
    color: '#00ff00',
    margin: 0
  },
  serviceType: {
    padding: '4px 8px',
    backgroundColor: '#00ff00',
    color: '#000',
    borderRadius: '4px',
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    fontWeight: 'bold' as const
  },
  serviceBody: {
    marginBottom: '12px'
  },
  description: {
    color: '#ccc',
    fontSize: '14px',
    marginBottom: '8px'
  },
  metadata: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap' as const
  },
  metadataItem: {
    fontSize: '12px',
    color: '#888'
  },
  serviceFooter: {
    display: 'flex',
    gap: '8px'
  },
  connectButton: {
    flex: 1,
    padding: '8px 16px',
    backgroundColor: '#00ff00',
    color: '#000',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    cursor: 'pointer'
  },
  linkButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#00ff00',
    border: '1px solid #00ff00',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    cursor: 'pointer'
  }
};

