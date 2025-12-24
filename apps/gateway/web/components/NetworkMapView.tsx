import { useRef } from 'react'

export default function NetworkMapView() {
  const mapRef = useRef<HTMLDivElement>(null)

  return (
    <div className="card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
        🗺️ Global Node Network
      </h2>

      <div
        style={{
          padding: '1rem',
          background: 'var(--info-soft)',
          borderRadius: '8px',
          marginBottom: '1rem',
        }}
      >
        <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--info)' }}>
          <strong>🔮 V2 Feature:</strong> Interactive world map showing all
          active nodes. Color-coded by performance (green = excellent, red =
          needs improvement).
        </p>
      </div>

      {/* Map Container */}
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '500px',
          background: 'var(--surface-hover)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed var(--border)',
        }}
      >
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <p
            style={{
              fontSize: '1.125rem',
              fontWeight: '600',
              marginBottom: '0.5rem',
            }}
          >
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
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginTop: '1rem',
          fontSize: '0.875rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              background: 'var(--success)',
              borderRadius: '50%',
            }}
          />
          <span>99%+ Uptime</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              background: 'var(--warning)',
              borderRadius: '50%',
            }}
          />
          <span>95-99% Uptime</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              background: 'var(--error)',
              borderRadius: '50%',
            }}
          />
          <span>&lt;95% Uptime</span>
        </div>
      </div>
    </div>
  )
}
