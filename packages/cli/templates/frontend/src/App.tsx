import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <header>
        <h1>{{DISPLAY_NAME}}</h1>
        <p>Deployed on Jeju Network via IPFS</p>
      </header>

      <main>
        <div className="card">
          <button onClick={() => setCount((count) => count + 1)}>
            Count: {count}
          </button>
        </div>

        <p className="info">
          Edit <code>src/App.tsx</code> and save to see changes
        </p>
      </main>

      <footer>
        <a href="https://jejunetwork.org" target="_blank" rel="noopener">
          Built with Jeju Network
        </a>
      </footer>
    </div>
  )
}

export default App
