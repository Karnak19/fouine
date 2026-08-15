# GitHub App Setup

fouine connects to GitHub as a GitHub App. This gives it per-repo access, webhook delivery, and the ability to post reviews.

## Create the app

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
2. Fill in:
   - **GitHub App name**: `fouine` (or your preferred name)
   - **Homepage URL**: your server URL (e.g. `https://fouine.example.com`)
   - **Webhook URL**: `https://your-server.com/webhook/github`
   - **Webhook secret**: generate a random string and save it

3. Set **Repository permissions**:
   - **Pull requests**: Read & Write (to post comments and reviews)
   - **Contents**: Read & Write (Read to clone repos; Write so the self-improvement loop can propose `REVIEW.md` updates as a PR — Read alone works if you don't use it)

4. Set **Subscribe to events**:
   - **Pull request**
   - **Issue comment** (for `/review` triggers)

5. Under **Where can this GitHub App be installed?**, choose:
   - **Only on this account** — for personal/org use
   - **Any account** — if you want others to install it

6. Click **Create GitHub App**

## Generate a private key

1. On the app's settings page, scroll to **Private keys**
2. Click **Generate a private key**
3. A `.pem` file will download — save it to your server

## Install the app

1. On the app's settings page, click **Install App**
2. Choose the account/org
3. Select which repos to review (or all)
4. Click **Install**

## Configure fouine

Set these environment variables (or use the `.env` file):

| Variable | Value |
|---|---|
| `GITHUB_APP_ID` | Found on the app's settings page |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Path to the `.pem` file |
| `GITHUB_WEBHOOK_SECRET` | The secret you set during creation |

::: tip
You can also use `GITHUB_APP_PRIVATE_KEY` with the key contents inline (literal `\n` are un-escaped). The `*_PATH` variant is recommended.
:::

## Webhook delivery

If your server is behind a reverse proxy or tunnel (ngrok, Cloudflare Tunnel), make sure the webhook URL is reachable from GitHub. You can test delivery from the app's **Advanced > Recent Deliveries** tab.
