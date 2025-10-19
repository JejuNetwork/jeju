#!/bin/bash

# Install dependencies

`bun install`

# Deploy the worker

`bunx wrangler deploy`

# Set secrets

```
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
```

# Set environment variables for production

bunx wrangler secret put ALLOWED_ORIGIN

# Update Github OAuth App

Setup a github oauth app and use the deployed worker URL as the auth callback url: `https://<worker-url>/api/auth/callback
