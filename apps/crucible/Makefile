.PHONY: help configure fund build up down logs agents stats test clean

help:
	@echo "Jeju Crucible - Multi-Agent Security Testing Platform"
	@echo ""
	@echo "Available commands:"
	@echo "  make configure  - Create .env file with API key"
	@echo "  make fund       - Fund all agent wallets (requires localnet)"
	@echo "  make build      - Build Docker containers"
	@echo "  make up         - Start Crucible platform"
	@echo "  make down       - Stop Crucible platform"
	@echo "  make logs       - View container logs"
	@echo "  make agents     - List all agents"
	@echo "  make stats      - View statistics"
	@echo "  make test       - Run tests"
	@echo "  make clean      - Clean up containers and volumes"

configure:
	@echo "⚙️  Configuring environment..."
	@bun run scripts/configure.ts

fund:
	@echo "💰 Funding agent wallets..."
	@bun run scripts/fund-wallets.ts

build:
	@echo "🔨 Building Docker containers..."
	@docker-compose -f docker/docker-compose.yml build

up:
	@echo "🚀 Starting Crucible..."
	@docker-compose -f docker/docker-compose.yml up -d
	@echo "✅ Crucible started!"
	@echo "   API: http://localhost:7777"
	@echo "   Dashboard: http://localhost:5010"

down:
	@echo "🛑 Stopping Crucible..."
	@docker-compose -f docker/docker-compose.yml down

logs:
	@docker-compose -f docker/docker-compose.yml logs -f crucible

agents:
	@echo "🎭 Listing agents..."
	@curl -s http://localhost:7777/api/agents | bun run -e "console.log(JSON.stringify(JSON.parse(await Bun.stdin.text()), null, 2))"

stats:
	@echo "📊 Crucible Statistics..."
	@curl -s http://localhost:7777/api/crucible/stats | bun run -e "console.log(JSON.stringify(JSON.parse(await Bun.stdin.text()), null, 2))"

test:
	@echo "🧪 Running tests..."
	@bun test

clean:
	@echo "🧹 Cleaning up..."
	@docker-compose -f docker/docker-compose.yml down -v
	@rm -rf data/ logs/

# Quick start - full setup
quickstart: configure fund build up
	@echo ""
	@echo "✅ Crucible is running!"
	@echo "   View logs: make logs"
	@echo "   List agents: make agents"
	@echo "   View stats: make stats"

