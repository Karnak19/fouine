# Slack and Discord

fouine can answer questions in Slack and Discord, and post a short message when a review finishes. Both are optional and read-only.

- **Ask fouine.** DM the bot or @mention it. It answers from the same data as [Chat](/guide/chat): reviews, findings, cost, repos. It keeps a memory per thread. It cannot start a review, post to GitHub, merge, or change a setting. Charts cannot be drawn there, so it describes them in text.
- **Review-done notifications.** When a PR review finishes, fouine posts `Review done on #<pr> — <n> blocking.` and the PR link in the channels you picked for that repo.

Both use the **Chat model**, so the model must be OpenAI-compatible. See [Chat and /build](/guide/chat#choosing-the-model).

## Before you start

Your fouine must be reachable from the internet, because Slack and Discord call it. These are the two webhook URLs. They have no login in front of them: each request is checked against the platform's signature, and a bad one gets `401`.

| Platform | URL |
|---|---|
| Slack | `https://<your-fouine-host>/webhook/channels/slack` |
| Discord | `https://<your-fouine-host>/webhook/channels/discord` |

A platform is switched on only when all of its required credentials are set. Until then its webhook answers `503`.

You can set credentials as environment variables or in the dashboard (**Settings**, Slack and Discord section). The dashboard value wins. Secrets and tokens saved there are write-only: the page never shows them back, and a blank field keeps the stored value.

## Slack

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps), from a manifest or from scratch.
2. Give the bot these scopes. They come from the Chat SDK Slack adapter's own setup guide, which fouine uses underneath: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `reactions:read`, `reactions:write`, `users:read`.
3. Under **Event Subscriptions**, set the request URL to the Slack URL above and subscribe to these bot events: `app_mention`, `message.channels`, `message.groups`, `message.im`, `message.mpim`.
4. Under **Interactivity**, turn it on and use the same URL.
5. Install the app to your workspace. Copy the **Bot User OAuth Token** (`xoxb-…`) and, from **Basic Information**, the **Signing Secret**.
6. Set them:

| Variable | Dashboard field | Required |
|---|---|---|
| `SLACK_SIGNING_SECRET` | Signing secret | yes |
| `SLACK_BOT_TOKEN` | Bot token | yes |
| `SLACK_BOT_USER_ID` | Bot user id | no, skips a lookup at startup |

7. Invite the bot to any channel you want it to answer in or post to (`/invite @yourbot`).

## Discord

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Note the **Application ID** and **Public Key**.
2. In **Bot**, reset the token and copy it. Turn on the **Message Content Intent**.
3. In **OAuth2, URL Generator**, pick the scopes `bot` and `applications.commands`. Pick the permissions Send Messages, Send Messages in Threads, Create Public Threads, Read Message History and Add Reactions. Open the generated URL to add the bot to your server.
4. Set the credentials:

| Variable | Dashboard field | Required |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Public key | yes |
| `DISCORD_BOT_TOKEN` | Bot token | yes |
| `DISCORD_APPLICATION_ID` | Application id | yes |
| `DISCORD_GATEWAY` | Keep the Gateway WebSocket connected | no, on by default |

### Gateway or webhook

Discord can reach fouine two ways:

- **Gateway** (default). fouine keeps one WebSocket open to Discord. This is how DMs and @mentions arrive, so leave it on if you want to talk to the bot. Turn it off with `DISCORD_GATEWAY=0` or the dashboard checkbox where a long-lived connection is a problem. The dashboard value overrides the env one.
- **Interactions webhook.** If you want Discord to send interactions to fouine over HTTP, set the Discord URL above as the **Interactions Endpoint URL** in the Developer Portal. Discord pings it to check, so fouine must already be running with the credentials set. Discord sends interactions through the Gateway or through this URL, not both.

Notifications work either way: they only need the bot token.

## Review-done notifications

Pick the channels per repo. The dashboard has one field for this, **Per-repo channels (JSON)**, in the Slack and Discord section of Settings:

```json
{
  "owner/repo": [
    { "platform": "slack", "channel": "C0123456789" },
    { "platform": "discord", "channel": "123456789012345678" }
  ]
}
```

`channel` is the platform's channel id, not a name or a URL. Add `"enabled": false` to pause one target without deleting it. Rows that don't match this shape are dropped. This setting has no environment variable.

How it behaves:

- One post per review, per channel. It only fires for real PR reviews, not for the improver, refiner or implementer.
- It is fire-and-forget and never retried. A slow or broken channel can't slow down or fail a review.
- A target whose platform has no credentials is skipped, and not counted as a failure.
- **Auto-disable.** If posting to a channel fails 5 times in a row, fouine disables that channel. A success resets the count. The disabled channel shows as a warning in Settings with its last error, and in the log. Fixing the cause (for example, inviting the bot to the channel) is not enough on its own: click **Clear warnings** to turn it back on.
