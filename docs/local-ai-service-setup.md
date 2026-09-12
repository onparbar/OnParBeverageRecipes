# Local AI service: prepared, not activated

## Architecture

The authenticated owner submits a question from the existing dashboard search.
The browser captures a bounded snapshot of the records already loaded there.
The on-site Next server sends the question and read-only tool descriptions to a
dedicated Ollama process at `127.0.0.1:11435`. Only relevant query results, not the
whole snapshot, enter the model prompt. No OpenAI or other hosted AI endpoint is
used. Supabase remains the dashboard's existing shared storage.

The model can select/filter/group records and request arithmetic. It cannot
execute SQL, JavaScript, shell commands, network requests or mutations. Tools
are fixed allowlisted functions, not instructions supplied by the model.

Follow-up context holds at most four turns in browser memory, not shared storage.
Typing uses the existing fast search. Enter or an example button submits to AI.
Typing a new question or closing results cancels the pending answer.

## Do not enable until the service Mac is assessed

The Mac Studio also hosts other business services. First obtain its chip, memory,
free memory under normal load, available disk space, and existing process manager
configuration. Choose a local GGUF model with Ollama tool support and leave room
for those services and the model's context/KV cache. Purchase price is not a safe
proxy for available memory. No model download or installation has been performed.

## Activation steps for the service administrator

1. Install a reviewed Ollama release on the service Mac, not the development Mac.
2. Run `scripts/run-local-beverage-ai.sh` under the service account's existing
   process manager. Pass an explicit `ONPAR_OLLAMA_BIN` if needed. Do not bind the
   daemon to all interfaces or publish its port through the dashboard tunnel.
3. Download the selected local model to that dedicated daemon using
   `OLLAMA_HOST=127.0.0.1:11435 ollama pull <reviewed-local-model>`.
4. Keep `OLLAMA_NO_CLOUD=1` on the daemon. Do not sign it into cloud inference.
5. In the persistent dashboard environment set `ONPAR_LOCAL_AI_MODEL` to the exact
   installed model name and, only after testing, `ONPAR_LOCAL_AI_ENABLED=1`.
6. Restart the dashboard using the existing controlled deployment process.
7. Confirm resource headroom and answer accuracy before normal business use.

To disable AI, unset `ONPAR_LOCAL_AI_ENABLED` or set it to `0`, and restart the
dashboard. The ordinary search remains available. There is no cloud fallback.

## Safeguards and limitations

- Owner authentication and same-origin JSON requests are required.
- A request is limited to 4 MiB and a snapshot to 30,000 rows.
- The server accepts only allowlisted dataset fields and scalar values.
- Inference has a 90-second deadline, one active request per server process,
  seven reasoning rounds and twelve read-only tool calls.
- The daemon is capped at one loaded model and one parallel inference request.
- Model names containing cloud are rejected; model metadata must show local GGUF
  weights and tool support. The dedicated daemon also disables cloud features.
- Missing/unverified observations stay null. Conflicting duplicate usage is null.
- Save/count guards withhold unreliable on-hand and order quantities.
- The source is the owner's currently loaded dashboard snapshot, not an
  independently refreshed database read. Snapshot capture time is not a PMB sync
  timestamp. Stale loaded records can still exist and must not be called live.
- AI explanations can still be wrong. Query sources are shown for auditing;
  numeric claims are not automatically proven equivalent to tool results.
- This is not a substitute for testing. Code, model capability, memory pressure,
  cancellation, authorization, tool limits, prompt-injection resistance, and
  known-answer comparisons have not yet been validated for this implementation.

## Primary references

- https://docs.ollama.com/api/chat
- https://docs.ollama.com/capabilities/tool-calling
- https://docs.ollama.com/faq (local-only mode)
