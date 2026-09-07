---
title: MCP endpoint
description: How a Claude Code session discovers and uses Oyster's built-in MCP tools.
---

Oyster serves its own tools to MCP-capable harnesses from the UI server at
`POST /mcp`. pi keeps using the bundled extensions in `extensions/`; Claude
Code reaches the same capabilities (`hublot`, `pinned_widget`,
`group_pinned_widgets`, `routine`, and a sudo-capable `bash`) through this
endpoint. Nothing is installed or registered on the machine for that to work:
every Claude Code process is told where the endpoint is when Oyster launches it.

## Discovery in one picture

1. Oyster starts a Claude Code runner with `--mcp-config <json>` and
   `--allowedTools mcp__oyster` on the command line.
2. At startup Claude Code parses that JSON, expands `${OYSTER_TOKEN}` from its
   environment, and connects to the `oyster` server it describes: an `http`
   server whose URL is Oyster's own `/mcp` route.
3. Claude Code sends the MCP `initialize` handshake and `tools/list`. Oyster
   answers with the five tools, which appear to the model as
   `mcp__oyster__bash`, `mcp__oyster__hublot`, and so on.
4. Each tool call is one more `POST /mcp`. Oyster identifies the caller from the
   URL, runs the tool, and streams the result back.

There is no lookup step, no file under `~/.claude`, and no stdio child process.
If the process was launched by Oyster, it has the endpoint; if it was not, it
does not.

## What the launch looks like

The Claude Code driver (`server/runner-drivers/claude-code.mjs`) builds the
configuration per launch. The value passed to `--mcp-config` is:

```json
{
  "mcpServers": {
    "oyster": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp?session=<session id>&workdir=<absolute path>&runner=<runner id>",
      "headers": { "Authorization": "Bearer ${OYSTER_TOKEN}" }
    }
  }
}
```

Three things about it are deliberate:

- **The caller is in the URL.** `runner`, `session`, and `workdir` are request
  parameters, not process-level configuration. Oyster reads them on every
  request, so the endpoint never has to remember who is talking to it, and one
  server instance serves every runner.
- **The token is not on the command line.** Command lines are visible to every
  process of the same user. The header contains the literal text
  `${OYSTER_TOKEN}`; Claude Code substitutes the value from the environment the
  driver gave it. The driver always defines `OYSTER_TOKEN`, empty when the
  server runs with `--unauthenticated`, so the expansion never fails.
- **Every launch gets a fresh configuration.** A restart or a `--resume` of an
  existing session rebuilds the JSON, so a runner that changed id or workspace
  is described correctly.

The base URL comes from `OYSTER_URL` when set and defaults to
`http://127.0.0.1:<port>`. The journal shows the exact command for each spawn:

```sh
journalctl --user -u oyster | grep "spawning runner"
```

## What happens on the server

`POST /mcp` is an ordinary authenticated route
(`server/http/routes/mcpRoutes.mjs`). Requests go through the same bearer-token
check as the rest of the API, then:

1. The route reads `runner`, `session`, and `workdir` from the query string.
   A relative `workdir` is rejected with `400`; a missing one falls back to the
   server's current workspace.
2. It creates one MCP server and one Streamable HTTP transport for the request
   (stateless mode) and hands the request to the transport. Both are discarded
   when the response closes.
3. Tools act through the regular route handlers, called in-process by
   `server/http/internalDispatch.mjs`. Pinning a file runs the same code as the
   browser's `POST /pinned-widgets`; opening a hublot runs `POST /tunnels`.
   There is no loopback HTTP call and no second implementation of any tool.

The sudo flow adds one hop. `bash` with `sudo: true` posts to
`POST /runner/ui-request?runner=<id>`, which pushes a masked `input` dialog to
that runner's browser clients over the existing event stream and waits for
the answer (up to ten minutes). The password is written to `sudo -S` on
standard input and never logged. If no browser is connected, the dialog cannot
be shown and the call eventually times out.

## Permissions

`--allowedTools mcp__oyster` pre-approves every tool of the `oyster` server in
permission modes that would otherwise prompt. The human gate for privileged
work is the sudo password dialog itself, not a tool-approval prompt.

## Using the endpoint from another client

Any MCP client that speaks Streamable HTTP can use the same URL. For a manual
Claude Code session outside Oyster:

```sh
claude mcp add --transport http oyster \
  "http://127.0.0.1:8080/mcp?session=<session id>&workdir=$PWD&runner=<runner id>" \
  --header "Authorization: Bearer $(cat .ui-token)"
```

Leave out `runner` if the client has no Oyster browser session; every tool
still works except `bash` with `sudo: true`, which reports that no runner is
attached. Leave out `session` and the tools that bind to a session (hublots,
routines, session-scoped widgets) refuse to run.

## Troubleshooting

- **The tools are missing from a session.** Check the spawn line in the
  journal for `--mcp-config`. If it is absent, the server is running an older
  driver: driver modules are reached through static imports that the hot
  reloader does not cache-bust, so restart the service after changing them.
- **`401` from `/mcp`.** The token in the runner's environment does not match
  the server's. Restart the runner so it inherits the current token.
- **Sudo calls hang, then fail.** No browser client was connected to receive
  the dialog. Open the session in a browser and retry.
- **Verifying by hand.** `tests/mcp-routes.test.mjs` drives the endpoint with
  the official MCP client; `node --test tests/mcp-routes.test.mjs` runs it.

See the [HTTP API](/reference/http-api/) for the route table and the
[architecture notes](/development/architecture/) for the runner drivers.
