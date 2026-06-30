# REST API

All endpoints are prefixed with `/api`. The dashboard and API are protected by HTTP Basic Auth when configured.

## Repos

### List repos

```
GET /api/repos
```

Returns an array of all registered repos.

### Get repo

```
GET /api/repos/:owner/:name
```

Returns a single repo or `404`.

### Register repo

```
POST /api/repos
Content-Type: application/json

{
  "full_name": "owner/repo",
  "installation_id": 12345
}
```

### Update repo

```
PUT /api/repos/:owner/:name
Content-Type: application/json

{
  "prompt": "Review this code for...",
  "model": "opencode-go/glm-5.2",
  "enabled": 1
}
```

All fields are optional. Returns the updated repo.

### Delete repo

```
DELETE /api/repos/:owner/:name
```

Returns `204 No Content`.

### List repo reviews

```
GET /api/repos/:owner/:name/reviews
```

Returns the last 200 reviews for the repo.

## Reviews

### List reviews

```
GET /api/reviews
```

Returns the last 100 reviews across all repos.

### Get review

```
GET /api/reviews/:id
```

Returns a single review or `404`.

### Get review session

```
GET /api/reviews/:id/session
```

Returns the OpenCode session transcript (messages, tool calls) for the review. Returns `{ "error": "session-unavailable" }` if the session data is not accessible.

### Retry review

```
POST /api/reviews/:id/retry
```

Re-runs the review for the same PR. Returns `202 Accepted` on success, `502` if the retry fails to start.

## Settings

### Get settings

```
GET /api/settings
```

Returns all dashboard-configured settings as a key-value object:

```json
{
  "opencode_api_key": "***",
  "opencode_model": "opencode-go/glm-5.2",
  "default_prompt": "Review this PR..."
}
```

### Update settings

```
PUT /api/settings
Content-Type: application/json

{
  "opencode_api_key": "your-key",
  "opencode_model": "opencode-go/glm-5.2",
  "default_prompt": "Review this PR..."
}
```

All fields are optional. Only provided fields are updated.

### Test connection

```
GET /api/settings/test
```

Sends a tiny prompt through the configured model to verify the API key and model work. Returns:

```json
{ "ok": true, "text": "OK" }
```

or:

```json
{ "ok": false, "error": "..." }
```
