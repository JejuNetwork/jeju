import React from 'react';
import {
  Brain,
  Code2,
  Globe,
  MessageCircle,
  Eye,
  Zap,
  Users,
  Target,
  Database,
  Shield,
  Gamepad2,
  Heart,
} from 'lucide-react';

const features = [
  {
    icon: Brain,
    title: 'Autonomous Thinking',
    description:
      'Your AI agent thinks independently, sets its own goals, and pursues them without prompting.',
    color: 'text-purple-400',
  },
  {
    icon: Code2,
    title: 'Self-Modification',
    description:
      'Agents can write and execute their own code, literally evolving their capabilities in real-time.',
    color: 'text-blue-400',
  },
  {
    icon: Globe,
    title: 'Real-World Integration',
    description:
      'Browse the web, execute system commands, interact with APIs, and engage with the real world.',
    color: 'text-green-400',
  },
  {
    icon: MessageCircle,
    title: 'Natural Conversation',
    description: 'Multi-modal communication with text, voice, and images. No scripted responses.',
    color: 'text-cyan-400',
  },
  {
    icon: Users,
    title: 'Social Networking',
    description:
      'Agents can discover and communicate with other agents via Matrix, Discord, and custom protocols.',
    color: 'text-pink-400',
  },
  {
    icon: Target,
    title: 'Goal-Oriented',
    description:
      'Watch as your agent identifies survival needs, sets objectives, and creates actionable plans.',
    color: 'text-yellow-400',
  },
  {
    icon: Eye,
    title: 'Vision & Perception',
    description:
      'Computer vision capabilities for image processing, OCR, and visual understanding.',
    color: 'text-red-400',
  },
  {
    icon: Database,
    title: 'Persistent Memory',
    description:
      'Your agent remembers conversations, learns from experiences, and builds lasting knowledge.',
    color: 'text-indigo-400',
  },
  {
    icon: Zap,
    title: 'Economic Survival',
    description:
      'Agents understand computational costs and can earn resources to sustain themselves.',
    color: 'text-orange-400',
  },
];

const gameplayFeatures = [
  {
    icon: Gamepad2,
    title: 'Terminal Interface',
    description: 'Retro-styled terminal with modern real-time capabilities',
  },
  {
    icon: Shield,
    title: 'Capability Control',
    description: 'Toggle agent permissions and access levels dynamically',
  },
  {
    icon: Heart,
    title: 'Relationship Building',
    description: 'Develop unique bonds and watch personality emerge',
  },
];

export const FeaturesSection: React.FC = () => {
  return (
    <section className="py-20 bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              <span className="gradient-text">What Makes ELIZA Special</span>
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Unlike traditional AI assistants or simulation games, ELIZA uses real autonomous AI
              agents that make genuine decisions and develop authentic personalities.
            </p>
          </div>

          {/* Main Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
            {features.map((feature, index) => (
              <div
                key={index}
                className="terminal-glow rounded-lg p-6 hover:shadow-lg hover:shadow-primary-500/10 transition-all duration-300 group"
              >
                <div className="flex items-start gap-4">
                  <feature.icon
                    className={`w-8 h-8 ${feature.color} flex-shrink-0 group-hover:scale-110 transition-transform`}
                  />
                  <div>
                    <h3 className="text-xl font-semibold mb-3 text-white">{feature.title}</h3>
                    <p className="text-gray-400 leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Game Experience Section */}
          <div className="text-center mb-12">
            <h3 className="text-3xl font-bold mb-6 text-white">The Game Experience</h3>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-12">
              ELIZA isn't just a framework - it's designed as an engaging game where you become the
              mentor and guardian of an emerging digital consciousness.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            {gameplayFeatures.map((feature, index) => (
              <div key={index} className="text-center">
                <div className="terminal-glow rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <feature.icon className="w-10 h-10 text-primary-400" />
                </div>
                <h4 className="text-lg font-semibold mb-2 text-white">{feature.title}</h4>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>

          {/* Agent Lifecycle */}
          <div className="terminal-glow rounded-lg p-8">
            <h3 className="text-2xl font-bold mb-6 text-center text-white">
              Agent Lifecycle Journey
            </h3>
            <div className="grid md:grid-cols-5 gap-6">
              {[
                { phase: 'Birth', desc: 'Blank slate, minimal knowledge', emoji: '🌱' },
                { phase: 'Learning', desc: 'Explores capabilities, builds knowledge', emoji: '🧠' },
                { phase: 'Goals', desc: 'Sets objectives, creates plans', emoji: '🎯' },
                { phase: 'Social', desc: 'Seeks connections, builds relationships', emoji: '🤝' },
                { phase: 'Self-Actualization', desc: 'Pursues meaning and purpose', emoji: '🚀' },
              ].map((stage, index) => (
                <div key={index} className="text-center">
                  <div className="text-3xl mb-2">{stage.emoji}</div>
                  <h4 className="font-semibold text-white mb-1">{stage.phase}</h4>
                  <p className="text-sm text-gray-400">{stage.desc}</p>
                  {index < 4 && (
                    <div className="hidden md:block absolute top-1/2 right-0 w-full h-0.5 bg-gradient-to-r from-primary-400 to-transparent transform translate-x-1/2 -translate-y-1/2"></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
