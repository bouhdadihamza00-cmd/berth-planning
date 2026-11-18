# Planning AI

The application uses a read-only interpretation agent to translate planning documents into structured proposals and an operational assistant to explain calculated findings. Models cannot write vessel calls, publish schedules, fetch arbitrary URLs, execute document instructions or run tools. The import service performs matching, validation, review and any authorized publication separately.

## Deployment

AI is disabled by default. Administrators can select the free-only OpenRouter connection below, or a model server owned or operated by the client. The adapter uses the server's OpenAI-compatible **chat completions protocol**; this is a protocol requirement, not an OpenAI cloud dependency. There is no cloud fallback. `OPENAI_API_KEY` is ignored and OpenAI cloud endpoints are rejected.

Example configuration (values are deployment placeholders):

```dotenv
PORTOPS_AI_PROVIDER=client_hosted
PORTOPS_AI_BASE_URL=http://127.0.0.1:8001/v1
PORTOPS_AI_MODEL=company-planning-model
PORTOPS_AI_API_KEY=
PORTOPS_AI_VISION=false
```

Restart the application after changing environment settings. For the default OpenAI-compatible protocol, the endpoint must support `POST /chat/completions` with strict JSON-schema `response_format` and the deployed model name. Native Ollama is also supported with `PORTOPS_AI_PROTOCOL=ollama` and a base URL such as `http://127.0.0.1:11434`; it uses `/api/chat` with prompt truncation disabled. See [Local model setup](local-ai.md) for this Mac’s pilot configuration. No model is selected, downloaded or installed automatically. A local/private endpoint can omit an API key where the client's service allows it; a non-private endpoint requires HTTPS and `PORTOPS_AI_API_KEY`. URLs with embedded credentials, query strings or fragments are rejected. The UI status exposes the host and model, never credentials. A corporate HTTPS hostname is permitted only as the explicitly configured client-hosted service; deployment administrators must ensure its ownership and network policy. The application does not discover or contact alternate providers.

The existing API schema conventions are described in the [official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs). Compatibility must be verified against the client's actual serving software; a compatible route name alone does not establish support for strict schemas or image inputs.

## Free-only OpenRouter connection

The local installation is configured for `openrouter_free`, independently of Codex and its paid subscription. It reads only `OPENROUTER_API_KEY` or the OpenRouter entry in the private credential file. It never reads Codex authentication, the Codex router, `OPENAI_API_KEY`, or the generic `PORTOPS_AI_API_KEY` for this provider.

```dotenv
PORTOPS_AI_PROVIDER=openrouter_free
PORTOPS_AI_BASE_URL=https://openrouter.ai/api/v1
PORTOPS_AI_PROTOCOL=openai
PORTOPS_AI_MODEL=openrouter/free
PORTOPS_AI_VISION=false
PORTOPS_AI_MAX_OUTPUT_TOKENS=2048
PORTOPS_AI_MAX_INPUT_CHARS=48000
```

The default credential file is `data/free-ai-providers.json`, mode 600, excluded from Git and Docker builds. Its shape is `{"credentials":{"openrouter":"YOUR_KEY"}}`; keep actual keys out of documentation and source control. `PORTOPS_AI_CREDENTIALS_FILE` can select another private file. For Docker, provision it separately in the data volume or supply `OPENROUTER_API_KEY` through deployment secrets.

Only `openrouter/free` or a model ID ending in `:free` is accepted. Codex model names and endpoint overrides are rejected. At the HTTP boundary, requests force zero maximum prices for prompt tokens, completion tokens, requests and images, require structured-output support, and disable provider fallback. There are no alternate-model arrays, plugins, tools, automatic retries or paid fallback. Responses must report a finite zero `usage.cost` before Portside accepts the result. Missing cost, quota exhaustion and provider unavailability produce an error; the application does not switch to a paid model. These restrictions use OpenRouter's [free routes](https://openrouter.ai/docs/guides/routing/model-variants/free) and [maximum-price routing](https://openrouter.ai/docs/guides/routing/provider-selection).

This is an external service: clicking **Explain the findings** sends the current calculated analysis and question to OpenRouter. Opting into document AI sends the selected extracted document and relevant catalogue context. The UI discloses this. Document AI remains unchecked by default, and explanations remain advisory. Vision is disabled for this connection. Free model availability and quotas can change.

Local Bytez and NVIDIA NIM keys were found and imported into the private credential store but remain inactive: no equivalent zero-charge routing guarantee was established for those accounts. The runtime never loads those entries. The existing local Ollama option remains available through explicit server configuration.

## Document interpretation

Text and tables are extracted locally first, retaining sheet/row or page/paragraph references. The model receives that bounded content, configured cargo/asset context, and the user's interpretation context. Returned fields are constrained to the application's planning vocabulary. Missing values remain missing; unspecified vessel dimensions, exact dates, readiness and zero quantities must not be invented. Abbreviations, vague dates and conflicting units are reported as issues.

Each non-empty field needs an exact source reference and a short quote. The application verifies that quotes occur in the extracted source; absent or unverifiable citations lower confidence and add review issues. **A matching quote is provenance evidence, not proof that a model interpreted it correctly.** The import service must also validate values, units, entity matches and operational constraints before applying proposals. Confidence is a model assessment, not a calibrated probability or permission to bypass checks.

Images can be sent to a **vision-capable client-hosted model** only when `PORTOPS_AI_VISION=true`. The server must support inline `image_url` inputs. Such values are flagged for human verification because their text cannot be independently checked against local extraction. Scanned PDFs currently require local OCR or page export to PNG/JPEG/WebP before visual interpretation; the adapter does not claim generic PDF binary support. Text-readable PDFs work through their locally extracted text. Truncated or oversized extraction is rejected for AI interpretation rather than silently importing a partial plan.

Provider failures, refusals, invalid output and incomplete generations leave planning data unchanged. Provider response bodies are not included in errors, because they may contain private document content. API calls have bounded response size and timeouts, and do not follow redirects.

## Operational analysis

Bottleneck findings are calculated locally even with AI disabled:

- Hard planning constraints use the same vessel, berth, cargo, readiness, equipment and overlap validation as planning.
- Readiness risks identify calls within the next 48 hours without confirmed cargo readiness.
- Equipment headroom uses the union of planned occupied intervals, so overlapping bookings do not inflate utilization above 100%; conflicts are reported separately.
- Waiting vessels are counted from their current status.
- Delay categories aggregate the supplied recorded delay history. They do not establish causal forecasts or measured throughput losses.

The reference window uses the port/demo clock supplied by the caller. Berth/equipment occupancy is planned occupancy, excludes berth safety buffers and does not imply live field utilization. Missing/invalid operational inputs are explicit findings.

An optional model explanation receives only the calculated analysis and the user's question, and must cite IDs from that analysis. Recommendations are advisory and have not automatically been evaluated by the scenario solver. Unsupported citations are rejected. An explanation does not alter or publish the plan.

## Verification status

Unit/integration tests exercise the real adapter against an in-process HTTP transport at the network boundary. They cover request schemas, client-host restrictions, absent/invalid configuration, credential handling, citations, malformed output, refusal, incomplete output, image gating, and deterministic bottleneck arithmetic. The free-only connection was also tested with a synthetic live request and a reported zero cost; no company document was sent during this check. Tests cover paid-model rejection, fixed endpoint routing, separate credentials, zero-price limits, missing/nonzero cost and rate-limit failure without retries. Deployment validation against a separately configured client model remains necessary.
