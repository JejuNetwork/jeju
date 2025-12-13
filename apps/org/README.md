# Org

Decentralized organization management with IPFS storage.

## Overview

Org provides decentralized team coordination features:

- **Todos**: Task management with priorities, assignees, and tags
- **Check-ins**: Scheduled standups, retrospectives, and team check-ins
- **Team Management**: Member tracking with activity stats
- **Reports**: Participation and blocker analysis

## Quick Start

```bash
# Install
bun install

# Run server
bun run dev
```

## API Reference

### Todos

```bash
# Create todo
POST /api/v1/orgs/:orgId/todos
{
  "title": "Review PR",
  "priority": "high",
  "dueDate": 1704067200000,
  "tags": ["code-review"]
}

# List todos
GET /api/v1/orgs/:orgId/todos?status=pending&limit=20

# Update todo
PATCH /api/v1/orgs/:orgId/todos/:todoId
{ "status": "in_progress" }

# Complete todo
POST /api/v1/orgs/:orgId/todos/:todoId/complete

# Get stats
GET /api/v1/orgs/:orgId/todos/stats
```

### Check-ins

```bash
# Create schedule
POST /api/v1/orgs/:orgId/checkins/schedules
{
  "roomId": "room-123",
  "name": "Daily Standup",
  "checkinType": "standup",
  "frequency": "weekdays",
  "timeUtc": "09:00"
}

# List schedules
GET /api/v1/orgs/:orgId/checkins/schedules

# Record response
POST /api/v1/orgs/:orgId/checkins/responses
{
  "scheduleId": "schedule-123",
  "responderAgentId": "agent-1",
  "answers": {
    "What did you accomplish?": "Completed PR review",
    "Any blockers?": "None"
  }
}

# Generate report
GET /api/v1/orgs/:orgId/checkins/:scheduleId/report
```

## Storage

All data is stored on IPFS with versioned state files:

```
org-{orgId}-v{version}.json
├── todos: Todo[]
├── checkinSchedules: CheckinSchedule[]
├── checkinResponses: CheckinResponse[]
├── teamMembers: TeamMember[]
└── metadata: Record<string, unknown>
```

## License

MIT
