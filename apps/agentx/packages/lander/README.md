# ELIZA Game Landing Page

A modern, responsive landing page for ELIZA - the AI Agent Sandbox Life Simulation game. Features automatic integration with GitHub Releases to provide the latest downloads for Mac, Windows, and Linux.

## Features

- **🚀 Modern Design** - Sleek, terminal-inspired aesthetic with Matrix rain effects
- **📱 Fully Responsive** - Works perfectly on desktop, tablet, and mobile devices
- **⚡ Real-time Downloads** - Automatically fetches latest releases from GitHub API
- **🎮 Game-Focused** - Highlights ELIZA's unique AI sandbox gameplay
- **🌐 Multi-Platform** - Download links for macOS, Windows, and Linux
- **⚡ Fast Performance** - Built with Vite for optimal loading speeds

## Technology Stack

- **React 19** - Latest React with concurrent features
- **TypeScript** - Full type safety and developer experience
- **Vite** - Lightning-fast build tool and dev server
- **Tailwind CSS** - Utility-first styling with custom animations
- **Lucide React** - Beautiful, consistent icons
- **GitHub API** - Dynamic release fetching and download links

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

## Development

```bash
# Type checking
npm run type-check

# Linting
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

## Features Deep Dive

### Automatic Release Detection

The landing page automatically detects and displays download links for the latest ELIZA releases:

- **macOS**: Universal DMG files with Apple Silicon support
- **Windows**: Native executables and installers
- **Linux**: AppImage (portable) and DEB packages

### Matrix Rain Effect

Custom-built Matrix-style rain animation using HTML5 Canvas, optimized for performance and responsive to window resizing.

### Terminal Aesthetic

The design captures the retro-terminal feel of ELIZA while maintaining modern usability:

- Glowing borders and text effects
- Monospace typography (JetBrains Mono)
- Green terminal colors with subtle animations
- Typing animations and cursor effects

### GitHub Integration

Real-time integration with GitHub Releases API:

- Fetches latest stable releases
- Parses asset names to determine platform and architecture
- Displays file sizes and download counts
- Handles API errors gracefully with fallback links

## Deployment

The landing page is automatically deployed via GitHub Actions:

1. **Build Trigger**: Pushes to `main` branch affecting `packages/lander/`
2. **Build Process**: Type checking, linting, and production build
3. **Deployment**: Automatic deployment to GitHub Pages
4. **URL**: Available at the configured GitHub Pages domain

### Manual Deployment

```bash
# Build production version
npm run build

# Deploy dist/ folder to your hosting provider
```

## Customization

### Colors and Themes

The design uses CSS custom properties and Tailwind CSS classes. Main color scheme:

- **Primary**: Blue gradient (`#0ea5e9` to `#0284c7`)
- **Accent**: Green gradient (`#22c55e` to `#16a34a`)
- **Terminal**: Matrix green (`#00ff00`)
- **Background**: Pure black to dark gray gradient

### Content Updates

Key sections to customize:

- `HeroSection.tsx` - Main headline, description, and terminal demo
- `FeaturesSection.tsx` - Feature highlights and agent lifecycle
- `DownloadSection.tsx` - Download section content and links
- `Footer.tsx` - Links, social media, and legal information

### GitHub Repository

Update the repository information in `useGithubReleases.ts`:

```typescript
const REPO_OWNER = 'ai16z';
const REPO_NAME = 'eliza';
```

## Analytics and Tracking

To add analytics:

1. Add your tracking script to `index.html`
2. Track download events in `DownloadSection.tsx`
3. Monitor page performance and user interactions

Example Google Analytics integration:

```javascript
// Track download clicks
const handleDownload = (platform: string) => {
  gtag('event', 'download', {
    event_category: 'engagement',
    event_label: platform
  })
  window.open(downloadUrl, '_blank')
}
```

## Performance Optimization

The landing page is optimized for performance:

- **Code Splitting**: Automatic chunks for optimal loading
- **Image Optimization**: Optimized assets and lazy loading
- **Font Loading**: Efficient web font loading strategy
- **CSS Optimization**: Purged unused styles in production
- **Bundle Analysis**: Use `npm run build` to analyze bundle size

## Browser Support

Supports all modern browsers:

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make changes and test thoroughly
4. Run type checking and linting: `npm run type-check && npm run lint`
5. Commit with conventional commits: `git commit -m 'feat: add amazing feature'`
6. Push and create a Pull Request

## License

MIT License - see the main repository for complete details.
