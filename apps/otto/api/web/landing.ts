/**
 * Otto Landing Page
 */

import { Elysia } from 'elysia'
import { getConfig } from '../config'

const config = getConfig()

const DISCORD_BOT_INVITE_URL =
  process.env.DISCORD_BOT_INVITE_URL ??
  'https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274878024704&scope=bot%20applications.commands'
const TELEGRAM_BOT_URL =
  process.env.TELEGRAM_BOT_URL ?? 'https://t.me/otto_jeju_bot'

const landingHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Otto — Your AI Trading Agent for Every Platform</title>
  <meta name="description" content="Trade, bridge, and launch tokens via Discord, Telegram, WhatsApp, Farcaster, and more. Otto is your AI-powered crypto companion.">

  <!-- OpenGraph / Twitter -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${config.baseUrl}">
  <meta property="og:title" content="Otto — AI Trading Agent">
  <meta property="og:description" content="Trade crypto anywhere. Discord, Telegram, WhatsApp, Farcaster, and more.">
  <meta name="twitter:card" content="summary_large_image">

  <!-- Farcaster Frame -->
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="${config.baseUrl}/frame/image">
  <meta property="fc:frame:button:1" content="Start Trading">
  <meta property="fc:frame:post_url" content="${config.baseUrl}/frame">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

  <style>
    :root {
      --otto-cyan: #00d4ff;
      --otto-purple: #8b5cf6;
      --otto-green: #22c55e;
      --otto-yellow: #fbbf24;
      --otto-dark: #0a0a0f;
      --otto-darker: #050508;
      --otto-card: rgba(20, 20, 30, 0.7);
      --otto-border: rgba(255, 255, 255, 0.08);
      --otto-glow: 0 0 60px rgba(0, 212, 255, 0.3);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      font-family: 'Outfit', system-ui, -apple-system, sans-serif;
      background: var(--otto-darker);
      color: #fff;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Animated background */
    .bg-pattern {
      position: fixed;
      inset: 0;
      background:
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 212, 255, 0.15), transparent),
        radial-gradient(ellipse 60% 40% at 80% 80%, rgba(139, 92, 246, 0.1), transparent),
        radial-gradient(ellipse 40% 30% at 20% 60%, rgba(34, 197, 94, 0.08), transparent);
      pointer-events: none;
      z-index: 0;
    }

    .grid-pattern {
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
      background-size: 60px 60px;
      pointer-events: none;
      z-index: 0;
    }

    /* Header */
    header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      backdrop-filter: blur(20px);
      background: rgba(5, 5, 8, 0.8);
      border-bottom: 1px solid var(--otto-border);
    }

    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      font-size: 24px;
      color: var(--otto-cyan);
      text-decoration: none;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--otto-cyan), var(--otto-purple));
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: var(--otto-glow);
    }

    .header-nav {
      display: flex;
      gap: 32px;
      align-items: center;
    }

    .header-nav a {
      color: rgba(255,255,255,0.7);
      text-decoration: none;
      font-weight: 500;
      transition: color 0.2s;
    }

    .header-nav a:hover {
      color: var(--otto-cyan);
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--otto-cyan), #0099ff);
      color: #000;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
      border: none;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(0, 212, 255, 0.4);
    }

    /* Hero Section */
    .hero {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 120px 24px 80px;
      text-align: center;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--otto-card);
      border: 1px solid var(--otto-border);
      padding: 8px 16px;
      border-radius: 100px;
      font-size: 14px;
      color: rgba(255,255,255,0.8);
      margin-bottom: 32px;
      animation: fadeInUp 0.8s ease-out;
    }

    .hero-badge-dot {
      width: 8px;
      height: 8px;
      background: var(--otto-green);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .hero h1 {
      font-size: clamp(48px, 8vw, 80px);
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 24px;
      animation: fadeInUp 0.8s ease-out 0.1s backwards;
    }

    .hero h1 .gradient {
      background: linear-gradient(135deg, var(--otto-cyan) 0%, var(--otto-purple) 50%, var(--otto-cyan) 100%);
      background-size: 200% 200%;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: gradientShift 5s ease infinite;
    }

    @keyframes gradientShift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }

    .hero-subtitle {
      font-size: clamp(18px, 2.5vw, 24px);
      color: rgba(255,255,255,0.6);
      max-width: 600px;
      margin: 0 auto 48px;
      line-height: 1.6;
      animation: fadeInUp 0.8s ease-out 0.2s backwards;
    }

    .hero-cta {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      justify-content: center;
      animation: fadeInUp 0.8s ease-out 0.3s backwards;
    }

    .btn-secondary {
      background: transparent;
      border: 2px solid rgba(255,255,255,0.2);
      color: #fff;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-secondary:hover {
      border-color: var(--otto-cyan);
      color: var(--otto-cyan);
    }

    /* Platforms Section */
    .platforms {
      position: relative;
      z-index: 1;
      padding: 80px 24px;
    }

    .platforms-inner {
      max-width: 1200px;
      margin: 0 auto;
    }

    .section-title {
      text-align: center;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 40px;
    }

    .platform-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      justify-content: center;
      max-width: 900px;
      margin: 0 auto;
    }

    .platform-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 24px;
      background: var(--otto-card);
      border: 1px solid var(--otto-border);
      border-radius: 16px;
      color: #fff;
      text-decoration: none;
      font-weight: 500;
      font-size: 16px;
      transition: all 0.3s;
      cursor: pointer;
    }

    .platform-btn:hover {
      transform: translateY(-4px);
      border-color: var(--otto-cyan);
      box-shadow: 0 8px 40px rgba(0, 212, 255, 0.2);
    }

    .platform-btn svg {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }

    .platform-btn.discord { --accent: #5865F2; }
    .platform-btn.telegram { --accent: #229ED9; }
    .platform-btn.farcaster { --accent: #855DCD; }
    .platform-btn.whatsapp { --accent: #25D366; }
    .platform-btn.twitter { --accent: #1DA1F2; }
    .platform-btn.web { --accent: var(--otto-cyan); }

    .platform-btn:hover {
      border-color: var(--accent);
      box-shadow: 0 8px 40px rgba(var(--accent), 0.2);
    }

    /* Features Section */
    .features {
      position: relative;
      z-index: 1;
      padding: 100px 24px;
    }

    .features-inner {
      max-width: 1200px;
      margin: 0 auto;
    }

    .features h2 {
      text-align: center;
      font-size: clamp(32px, 5vw, 48px);
      font-weight: 700;
      margin-bottom: 60px;
    }

    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
    }

    .feature-card {
      background: var(--otto-card);
      border: 1px solid var(--otto-border);
      border-radius: 24px;
      padding: 32px;
      transition: all 0.3s;
    }

    .feature-card:hover {
      transform: translateY(-4px);
      border-color: var(--otto-cyan);
    }

    .feature-icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, var(--otto-cyan), var(--otto-purple));
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin-bottom: 20px;
    }

    .feature-card h3 {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .feature-card p {
      color: rgba(255,255,255,0.6);
      line-height: 1.6;
    }

    /* Chat Demo Section */
    .chat-demo {
      position: relative;
      z-index: 1;
      padding: 100px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .chat-window {
      width: 100%;
      max-width: 600px;
      background: var(--otto-card);
      border: 1px solid var(--otto-border);
      border-radius: 24px;
      overflow: hidden;
      box-shadow: var(--otto-glow);
    }

    .chat-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--otto-border);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .chat-header-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--otto-cyan), var(--otto-purple));
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .chat-header-info h3 {
      font-size: 16px;
      font-weight: 600;
    }

    .chat-header-info span {
      font-size: 13px;
      color: var(--otto-green);
    }

    .chat-messages {
      padding: 24px;
      height: 400px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      max-width: 80%;
      padding: 14px 18px;
      border-radius: 18px;
      font-size: 15px;
      line-height: 1.5;
      animation: fadeInUp 0.4s ease-out;
    }

    .message.user {
      background: linear-gradient(135deg, var(--otto-cyan), #0099ff);
      color: #000;
      align-self: flex-end;
      border-bottom-right-radius: 6px;
    }

    .message.otto {
      background: rgba(255,255,255,0.1);
      align-self: flex-start;
      border-bottom-left-radius: 6px;
    }

    .message.otto code {
      font-family: 'JetBrains Mono', monospace;
      background: rgba(0,0,0,0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }

    .message.otto strong {
      color: var(--otto-cyan);
      font-weight: 600;
    }

    .message .bullet {
      color: var(--otto-cyan);
      font-weight: 600;
    }

    .chat-input {
      padding: 16px 24px;
      border-top: 1px solid var(--otto-border);
      display: flex;
      gap: 12px;
    }

    .chat-input input {
      flex: 1;
      background: rgba(255,255,255,0.08);
      border: 1px solid var(--otto-border);
      border-radius: 12px;
      padding: 14px 18px;
      color: #fff;
      font-size: 15px;
      font-family: inherit;
    }

    .chat-input input::placeholder {
      color: rgba(255,255,255,0.4);
    }

    .chat-input button {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--otto-cyan), #0099ff);
      border: none;
      border-radius: 12px;
      color: #000;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
    }

    .chat-input button:hover {
      transform: scale(1.05);
    }

    /* Footer */
    footer {
      position: relative;
      z-index: 1;
      padding: 60px 24px;
      border-top: 1px solid var(--otto-border);
    }

    .footer-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 24px;
    }

    .footer-links {
      display: flex;
      gap: 24px;
    }

    .footer-links a {
      color: rgba(255,255,255,0.6);
      text-decoration: none;
      font-size: 14px;
      transition: color 0.2s;
    }

    .footer-links a:hover {
      color: var(--otto-cyan);
    }

    .footer-brand {
      color: rgba(255,255,255,0.4);
      font-size: 14px;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .header-nav {
        display: none;
      }

      .hero-cta {
        flex-direction: column;
        width: 100%;
        max-width: 300px;
      }

      .hero-cta .btn-primary,
      .hero-cta .btn-secondary {
        width: 100%;
        justify-content: center;
      }

      .footer-inner {
        flex-direction: column;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div class="bg-pattern"></div>
  <div class="grid-pattern"></div>

  <header>
    <div class="header-inner">
      <a href="/" class="logo">
        <div class="logo-icon">O</div>
        Otto
      </a>
      <nav class="header-nav">
        <a href="#features">Features</a>
        <a href="#platforms">Platforms</a>
        <a href="/miniapp">Chat</a>
        <a href="/api/info">API</a>
        <a href="/miniapp" class="btn-primary">Start Trading</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="hero-badge">
        <span class="hero-badge-dot"></span>
        Powered by ElizaOS + Jeju Network
      </div>

      <h1>
        Your <span class="gradient">AI Trading Agent</span><br>
        for Every Platform
      </h1>

      <p class="hero-subtitle">
        Trade, bridge, and launch tokens via Discord, Telegram, WhatsApp, Farcaster, and more. Otto is your AI-powered crypto companion.
      </p>

      <div class="hero-cta">
        <a href="/miniapp" class="btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Start Trading
        </a>
        <a href="#platforms" class="btn-secondary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          Add to Your Platform
        </a>
      </div>
    </section>

    <section class="platforms" id="platforms">
      <div class="platforms-inner">
        <p class="section-title">Available where you are</p>

        <div class="platform-grid">
          <a href="${TELEGRAM_BOT_URL}" target="_blank" class="platform-btn telegram">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
            Telegram
          </a>

          <a href="${DISCORD_BOT_INVITE_URL}" target="_blank" class="platform-btn discord">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
            </svg>
            Discord
          </a>

          <a href="/miniapp/farcaster" class="platform-btn farcaster">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.24 3.6H5.76A2.16 2.16 0 0 0 3.6 5.76v12.48a2.16 2.16 0 0 0 2.16 2.16h12.48a2.16 2.16 0 0 0 2.16-2.16V5.76a2.16 2.16 0 0 0-2.16-2.16zm-2.4 4.8v7.2h-2.4v-4.8l-1.44 2.88-1.44-2.88v4.8H8.16v-7.2h2.4L12 11.28l1.44-2.88h2.4z"/>
            </svg>
            Farcaster
          </a>

          <a href="/miniapp" class="platform-btn whatsapp">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
            </svg>
            WhatsApp
          </a>

          <a href="/miniapp" class="platform-btn twitter">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            X / Twitter
          </a>

          <a href="/miniapp" class="platform-btn web">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Web Chat
          </a>
        </div>
      </div>
    </section>

    <section class="features" id="features">
      <div class="features-inner">
        <h2>Trade smarter, everywhere</h2>

        <div class="feature-grid">
          <div class="feature-card">
            <div class="feature-icon">⚡</div>
            <h3>Instant Swaps</h3>
            <p>Swap any token with best-rate routing across DEXs. Just say "swap 1 ETH to USDC" and Otto handles the rest.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">🌉</div>
            <h3>Cross-Chain Bridge</h3>
            <p>Bridge tokens across Ethereum, Base, Optimism, Arbitrum, and Solana with intent-based fills for speed.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">🚀</div>
            <h3>Token Launch</h3>
            <p>Launch your own token with liquidity in seconds. Clanker-style memecoin creation made simple.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">📊</div>
            <h3>Portfolio Tracking</h3>
            <p>View your holdings across all chains. Get real-time prices and 24h changes at a glance.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">🔐</div>
            <h3>Secure & Non-Custodial</h3>
            <p>Your keys, your coins. Connect any wallet and trade with session keys for convenience.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">🤖</div>
            <h3>AI-Powered</h3>
            <p>Natural language understanding powered by ElizaOS. Just chat like you would with a friend.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="chat-demo">
      <h2 style="margin-bottom: 40px; font-size: 32px;">Try it now</h2>

      <div class="chat-window">
        <div class="chat-header">
          <div class="chat-header-icon">O</div>
          <div class="chat-header-info">
            <h3>Otto</h3>
            <span>Online</span>
          </div>
        </div>

        <div class="chat-messages" id="demo-chat">
          <div class="message otto">
            Hey there. I'm Otto, your AI trading assistant. I can help you swap tokens, bridge across chains, check prices, and more.
            <br><br>
            What would you like to do?
          </div>
        </div>

        <div class="chat-input">
          <input type="text" id="demo-input" placeholder="Try: swap 1 ETH to USDC" autocomplete="off">
          <button id="demo-send">→</button>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-inner">
      <div class="footer-links">
        <a href="https://jejunetwork.org" target="_blank">Jeju Network</a>
        <a href="/api/info">API</a>
        <a href="https://github.com/jejunetwork/otto" target="_blank">GitHub</a>
      </div>
      <div class="footer-brand">
        Otto Trading Agent — Powered by ElizaOS + Jeju Network
      </div>
    </div>
  </footer>

  <script>
    const API = '${config.baseUrl}/api/chat';
    let sessionId = null;
    const chat = document.getElementById('demo-chat');
    const input = document.getElementById('demo-input');
    const sendBtn = document.getElementById('demo-send');

    async function initSession() {
      const res = await fetch(API + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const data = await res.json();
      sessionId = data.sessionId;
    }

    function addMessage(text, isUser) {
      const div = document.createElement('div');
      div.className = 'message ' + (isUser ? 'user' : 'otto');

      // Escape HTML first for safety
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Simple markdown formatting
      const formatted = escaped
        .replace(/**([^*]+)**/g, '<strong>$1</strong>')   // **bold**
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')          // \`code\`
        .replace(/• /g, '<span class="bullet">•</span> ')      // bullet points
        .replace(/\\n/g, '<br>')                               // escaped newlines
        .replace(/\n/g, '<br>');                               // actual newlines

      div.innerHTML = formatted;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;

      input.value = '';
      addMessage(text, true);

      if (!sessionId) {
        await initSession();
      }

      const res = await fetch(API + '/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        },
        body: JSON.stringify({ message: text })
      });

      const data = await res.json();
      addMessage(data.message.content, false);
    }

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    sendBtn.addEventListener('click', sendMessage);

    initSession();
  </script>
</body>
</html>`

export const landingApi = new Elysia().get('/', ({ set }) => {
  set.headers['Content-Type'] = 'text/html'
  return landingHtml
})

export default landingApi
