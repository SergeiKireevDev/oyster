# OpenRouter in Oyster harnesses

## Scope

Provider selection is **global per harness**, not per session. Credentials → Native harness provider offers `native` or `openrouter` for enabled Codex and Claude Code installations, with an explicit confirmation checkbox. Switching persists a non-secret enum in Oyster's SQLite `app_settings` (`harness_provider_codex` / `harness_provider_claude-code`) and restarts that harness's active runners. Existing harness identities and SQLite session sinks are unchanged.

Save a new OpenRouter key in that panel, or use the saved OpenRouter API key / server `OPENROUTER_API_KEY`. Pi continues to use its existing credentials and model picker. Keys stay in Pi's `auth.json` or the server environment, not app settings or CLI arguments. Native launches resolve the key lazily; saved literal API keys take precedence over environment fallback. Command-based Pi credentials (`!…`) are not executed by this integration. API status exposes only availability, never values.

Replacing or removing a saved OpenRouter key restarts Pi and enabled OpenRouter-routed Codex/Claude Code runners. Removing a stored key does not remove an environment fallback or revoke a key at OpenRouter. A missing key fails routed launches closed; it does not fall back to native OAuth. Native OAuth credentials are preserved when switching back.

## Supported native paths

- **Pi:** existing native OpenRouter support; unchanged.
- **Codex:** custom `openrouter` provider at `https://openrouter.ai/api/v1`, using `auth.command=/usr/bin/printenv` with `auth.args=["OPENROUTER_API_KEY"]`. Execution and native `app-server` discovery share route arguments. Discovery uses initialize → model/list without requiring an OAuth account/read for this custom provider. Returned model IDs retain the `openrouter` label and work with set_model. Until a model is selected, routed execution defaults to `openai/gpt-5.4`. Requires a Codex version supporting command authentication and custom-provider catalogs (upstream evidence: 0.153.4).
- **Claude Code:** native Messages gateway at `https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN`, empty `ANTHROPIC_API_KEY`, and `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`. Native list_models and set_model control requests are retained. Anthropic role defaults are Opus 4.6, Sonnet 4.6, and Haiku 4.5. Gateway authentication uses an app-managed `PI_AGENT_DIR/oyster-claude-openrouter` config directory, not the saved native OAuth directory. Its projects symlink points to the configured native projects directory, retaining native transcript/resume-ID access and the existing SQLite sink. Native user settings/plugins are not copied to the isolated gateway config. Requires Claude Code with gateway discovery support.
- **Amp:** supported through **native account-level router provisioning**, not direct per-process gateway environment variables. The Credentials panel gates native setup instructions on existing Amp authentication and explicit acknowledgement that provisioning **uploads the key to the Amp account**. Oyster does not provision on startup, upload automatically, or infer ownership from an unverified connection schema. The mode picker and Amp account requirement are unchanged. Routing may affect Amp usage outside Oyster as well.
- **Gemini CLI:** **not supported with OpenRouter**. Its Google generateContent gateway is not compatible with the OpenRouter Responses/Messages/Chat endpoints. Use native Google authentication.

## Amp: deliberate manual provisioning

After signing in to Amp, review `amp config model-providers list --json`. It returns complete non-secret connection metadata. In a private terminal, after consenting to the account upload, provision only if an Oyster-owned connection does not already exist:

```sh
printf '%s' "$OPENROUTER_API_KEY" | amp config model-providers add-router openrouter --personal --name Oyster --active --api-key-file -
```

Do not enable shell tracing. No literal key belongs in shell history or argv. If the Oyster connection already exists, rotate its key with `amp config model-providers edit-router CONNECTION_ID --api-key-file -`, supplying the key through stdin. Use native show/activate/deactivate/delete commands to manage that connection; never delete or replace unrelated connections. Automatic idempotent account management is intentionally not claimed until the native connection schema and ownership can be safely verified.

**Saving/replacing/removing the Pi key does not rotate/revoke Amp's uploaded copy.** Manage that copy separately through Amp's native commands. There is no persisted Oyster Amp provider toggle pretending to control the account router.

## Validation and boundaries

Focused fake-CLI tests cover Codex discovery/execution, command-auth arguments, provider selection, credential rotation, native OAuth preservation, Claude launch environment and model selection, canary-safe metadata/argv, stream redaction, and Amp prerequisite/disclosure gating. Native diagnostic streams are redacted before reaching Oyster's logs, SSE, and in-memory transcript pipeline.

Development does not perform network inference or upload existing keys. Live provider billing, real gateway catalog availability, and real cross-route Claude resumes still require an operator's explicitly authorized integration test. Additional user-supplied native CLI flags/settings can affect behavior; use versions documented upstream and avoid conflicting provider overrides.

References:
- https://openrouter.ai/docs/cookbook/coding-agents/codex-cli.md
- https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration.md
