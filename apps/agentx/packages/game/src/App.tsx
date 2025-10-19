import { useState, useEffect } from 'react';
import './App.css';
import StartupFlow from './components/StartupFlow';
import { GameInterface } from './components/GameInterface';
import { TauriInitializer } from './components/TauriInitializer';
import { debugWebSockets } from './utils/debugWebSockets';
import { blockOldMessages } from './utils/blockOldMessages';

// Start WebSocket debugging immediately
debugWebSockets();
blockOldMessages();

function App() {
  // Check if we should skip startup (for testing)
  const skipStartup = localStorage.getItem('skipStartup') === 'true';
  const [startupComplete, setStartupComplete] = useState(skipStartup);

  // Clear skipStartup flag after reading it
  useEffect(() => {
    if (skipStartup) {
      localStorage.removeItem('skipStartup');
    }
  }, [skipStartup]);

  const handleStartupComplete = () => {
    console.log('[App] Startup flow completed, transitioning to main interface');
    setStartupComplete(true);
  };

  if (!startupComplete) {
    console.log('[App] Rendering startup flow');
    return (
      <TauriInitializer>
        <div className="app">
          <StartupFlow onComplete={handleStartupComplete} />
        </div>
      </TauriInitializer>
    );
  }

  console.log('[App] Rendering main game interface');
  return (
    <TauriInitializer>
      <div className="app">
        <GameInterface />
      </div>
    </TauriInitializer>
  );
}

export default App;
