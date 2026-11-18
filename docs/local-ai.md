# Local Qwen model for the demo

This checkout includes an ignored project-local Ollama runtime in `.local-ai/runtime` and uses `.local-ai/models` for downloaded weights. The runtime comes from the official Ollama release, with the published asset digest verified. Neither binaries nor model weights are committed to Git.

The selected pilot model is **Qwen3-VL 8B Instruct** (`qwen3-vl:8b-instruct`). This Mac has an Intel i9 and 16 GB RAM, so inference runs on the CPU. The 14B alternative is not enabled on this machine; it needs more memory headroom. A client GPU server is preferable for larger documents and concurrent users.

## Run

With port 8000 free, start the local app and model server together:

```sh
npm run start:local
```

Or use two terminals:

```sh
npm run ai
npm start
```

The stack launcher reuses an existing localhost model server. On exit it stops only processes that it started. Standard `npm start` still starts the app alone.

`start-local-ai.sh` binds Ollama to 127.0.0.1:11434, disables cloud features, loads at most one model and uses one inference request at a time. Models unload after 5 minutes idle. It does not register a system login item or expose the model server on the network.

## App configuration

Server-side `.env` settings for the local pilot:

```dotenv
PORTOPS_AI_PROVIDER=client_hosted
PORTOPS_AI_PROTOCOL=ollama
PORTOPS_AI_BASE_URL=http://127.0.0.1:11434
PORTOPS_AI_MODEL=qwen3-vl:8b-instruct
PORTOPS_AI_API_KEY=
PORTOPS_AI_VISION=true
PORTOPS_AI_CONTEXT_TOKENS=8192
PORTOPS_AI_MAX_OUTPUT_TOKENS=4096
PORTOPS_AI_MAX_INPUT_CHARS=24000
PORTOPS_AI_TIMEOUT_SECONDS=300
```

Use the explicit `8b-instruct` tag. The generic `8b` tag generated extended reasoning in this pilot despite `think:false` and did not complete the extraction check within five minutes.

The native Ollama adapter uses `/api/chat`, JSON-schema output, `truncate:false`, and explicit context/output limits. It refuses incomplete generation. Large inputs are rejected rather than silently dropping source text. Split large documents or use focused exports. Scanned PDFs still need OCR or image-page export; enabling vision does not change that import limitation.

The generic client-hosted OpenAI-compatible adapter remains available with `PORTOPS_AI_PROTOCOL=openai` (the default) and a base URL ending in `/v1`. No cloud fallback is introduced.

Model inference remains read-only. Document interpretation creates reviewable proposals, and planning rules, permissions and approvals still control publication.

## Sources

- [Qwen model and download size](https://ollama.com/library/qwen3-vl:8b-instruct)
- [Ollama macOS CPU support](https://docs.ollama.com/macos)
- [Local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features)

## Live verification

Run `.venv311/bin/python scripts/check-local-ai.py --vision` to check extraction, cited explanations and visual review safeguards. The script uses synthetic data only and does not read or update planning records.

## Verified pilot results

On this Intel i9 / 16 GB Mac, the explicit Instruct model passed synthetic text extraction with source quotes in 79.8 seconds, a cited operational explanation in 18.7 seconds, and image extraction with mandatory review flags in 126.5 seconds. Model memory was about 7.06 GB at an 8192-token context. These small synthetic checks establish the connection and safeguards, not accuracy or throughput for arbitrary company documents. Large documents may exceed this pilot’s limits.
