import { DownloadSection } from './components/DownloadSection';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';

function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      <HeroSection />
      <DownloadSection />
      <Footer />
    </div>
  );
}

export default App;
