# Quick Start

Get fouine running and reviewing PRs in under 10 minutes.

## Prerequisites

- Docker and Docker Compose
- A GitHub account
- An [OpenCode API key](https://opencode.ai)

## 1. Create a GitHub App

Follow the [GitHub App setup guide](/guide/github-app) to create and configure your app. You'll need:

- The **App ID**
- A **private key** (`.pem` file)
- The **webhook secret**

## 2. Configure

```sh
cp .env.example .env
```

Fill in the required values:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=./app.pem
GITHUB_WEBHOOK_SECRET=your-webhook-secret
OPENCODE_API_KEY=your-opencode-key
```

## 3. Start

```bash
docker compose up -d
```

fouine is now running on `http://localhost:3000`.

## 4. Register a repo

Open the dashboard at `http://localhost:3000`, go to **Repos**, and register the repository you want reviewed. Make sure the GitHub App is installed on that repo.

## 5. Open a PR

Open (or push to) a pull request on the registered repo. fouine will automatically receive the webhook, clone the repo, run the AI review, and post comments on the PR.

## 6. Trigger manually

Comment `/review` on any PR to trigger an on-demand review:

```
/review
```

That's it. Check the [Configuration](/guide/configuration) page to customize the review prompt, model, and more.
