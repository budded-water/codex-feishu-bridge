# Feishu setup

The owner installation has completed application setup, SDK connection, and challenge enrollment. A full task and approval round trip is still pending; see [live acceptance](live-acceptance.md). New installations must complete the steps below with their own application.

## Create and configure the application

1. In the [Feishu developer console](https://open.feishu.cn/app), create an enterprise self-built application and enable its bot capability.
2. Copy its App ID and App Secret into the private `.env` file. Keep the secret off chat and out of git.
3. Enable reading private messages sent to the bot and sending messages as the application bot. The developer console and [message event documentation](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive) show the required scopes for your application.
4. Subscribe to `im.message.receive_v1` and choose SDK long connection mode. The local SDK client must be connected when saving this subscription mode.
5. Publish the application version and make it available to your account. No group-chat or document permissions are required by the bridge's initial transport.

The application bot is the chat interface. Local Codex continues to use its own separately configured tools and identities.

## Obtain your application-specific open ID

After supplying application credentials, run:

```bash
npm run identify
```

Enrollment connects the Feishu SDK and prints a random `pair ...` challenge locally. Keep it running while saving long connection settings in the developer console.

Send the exact challenge in a private chat with the application bot from your own account. The command prints that sender's open ID, then disconnects. Put that ID in `allowedUsers` in the private `bridge.config.json`.

Enrollment never starts Codex, accepts tasks, or sends a reply. It ignores nonmatching messages and expires after 15 minutes. Do not share the challenge: the account that sends it is the account you will allow.

Open IDs are application-specific. An ID from another bot or CLI application's login may not identify you for this application.

## First live acceptance run

1. Register an existing local project directory; run `npm run doctor`, `npm run build`, and `npm start`.
2. Send `/project <alias>` and `/status` to verify private-message transport.
3. Send a bounded read-only prompt, such as summarizing top-level files without modifications. Confirm acknowledgment, progress, and final output.
4. Send a follow-up to verify context continues. Test `/new` after work has completed.
5. Start a longer bounded task; verify `/补充` and `/stop` reach the right turn.
6. Exercise a bounded local action that triggers approval under your existing Codex policy. Confirm the preview and `/拒绝` work. Repeat with explicit approval if desired.
7. Restart the bridge. Confirm conversation mappings persist and uncertain tasks are not automatically replayed.

Only claim live acceptance after observing these results. Automated tests and the local handshake do not validate external scopes, account availability, model inference, or live delivery.

## Troubleshooting

- No connection: verify credentials, self-built app type, network access, and long connection mode.
- No incoming messages: verify published permissions, subscription, bot availability, and private text chat.
- Ignored messages: verify `allowedUsers` belongs to this application; repeat enrollment from your own account.
- Codex unavailable: run `npm run doctor`, verify local Codex authentication separately, and restart after correcting installation or configuration.

The [official Feishu Node SDK](https://github.com/larksuite/node-sdk) is the transport reference. Changes to external credentials, scopes, subscriptions, or availability must stay consistent with local configuration and these requirements.
