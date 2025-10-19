/**
 * @fileoverview V2 Feature: Network map visualization with Leaflet
 * @module gateway/components/NetworkMapView
 * 
 * Shows:
 * - All active nodes on world map
 * - Color-coded by performance (green=good, yellow=ok, red=poor)
 * - Clustered when zoomed out
 * - Interactive popups with node details
 */

import { useEffect, useRef } from 'react';
import { useNodeStaking } from '../hooks/useNodeStaking';

// NOTE: Leaflet integration requires:
// 1. npm install leaflet react-leaflet
// 2. Import CSS in layout
// 3. Dynamic import (SSR issues)

export default function NetworkMapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const { operatorNodeIds } = useNodeStaking();
  
  useEffect(() => {
    if (!mapRef.current) return;
    
    // V2: Full Leaflet implementation when ready
    // For now, show node count and locations in list view
    const nodeCount = operatorNodeIds?.length || 0;
    console.log('Network map: Nodes to display:', nodeCount);
    
    // Future: Initialize Leaflet, add markers, clustering
  }, [operatorNodeIds]);
  
  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
        🗺️ Global Node Network
      </h2>
      
      <div style={{ padding: '1rem', background: '#dbeafe', borderRadius: '8px', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.875rem', margin: 0, color: '#1e40af' }}>
          <strong>🔮 V2 Feature:</strong> Interactive world map showing all active nodes.
          Color-coded by performance (green = excellent, red = needs improvement).
        </p>
      </div>
      
      {/* Map Container */}
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '500px',
          background: '#f8fafc',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed #e2e8f0'
        }}
      >
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <p style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.5rem' }}>
            Interactive Map (V2)
          </p>
          <p style={{ fontSize: '0.875rem' }}>
            Install Leaflet to enable geographic visualization
          </p>
          <p style={{ fontSize: '0.75rem', marginTop: '1rem' }}>
            npm install leaflet react-leaflet @types/leaflet
          </p>
        </div>
      </div>
      
      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', fontSize: '0.875rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: '16px', height: '16px', background: '#22c55e', borderRadius: '50%' }} />
          <span>99%+ Uptime</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: '16px', height: '16px', background: '#eab308', borderRadius: '50%' }} />
          <span>95-99% Uptime</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: '16px', height: '16px', background: '#ef4444', borderRadius: '50%' }} />
          <span>&lt;95% Uptime</span>
        </div>
      </div>
    </div>
  );
}


