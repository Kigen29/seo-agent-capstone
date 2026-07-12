# ADR-0005: Provider-agnostic LLM layer addressed by role, not by vendor

**Status:** Accepted
**Date:** 2026-07-12

## Context
We are starting on an OpenAI key with existing credit. That credit will run out. Free tiers (Google AI Studio, Groq) exist today and will change. Model names change every few months. Prices change. We may want a local model via Ollama for the high-volume extraction work.

If provider and model names are scattered across the codebase, every one of those events becomes a code change, a pull request, a redeploy, and a regression risk.

There is also a methodological requirement: the LLM evaluation harness must not be graded by the same model family it is testing, or self-preference bias inflates our precision numbers.

## Decision
Application code addresses models by **role**, never by vendor:

- `fast` - extraction, classification, summarisation. High volume, low stakes.
- `smart` - reasoning and code generation for fixes. Low volume, high stakes.
- `embed` - page embeddings for internal linking and content gaps.
- `judge` - grades the eval harness. Must be a different family than the model under test.

Roles resolve at runtime from environment variables, as **ordered fallback chains**:

```
LLM_SMART=openai:gpt-4.1,google:gemini-2.5-pro,groq:llama-3.3-70b-versatile
```

Three properties make this work:

1. **Targets whose API key is absent are silently dropped from the chain.** A chain can name five providers; only the ones with keys present are used. Nothing breaks, and no code changes when a key appears or disappears.
2. **Retriable failures (429, quota exhausted, 503, timeout) fall through to the next target.** Non-retriable errors throw immediately.
3. **`packages/llm/src/providers.ts` is the only file in the codebase that imports a vendor SDK.** Groq, OpenRouter, Ollama and any custom endpoint are OpenAI-compatible, so they reuse the OpenAI client with a different base URL. A brand new bespoke provider costs one `case` statement.

We use the Vercel AI SDK (`ai` + `@ai-sdk/*`) as the unified interface, and `generateObject` with a Zod schema for anything the code will parse. **We never parse free text.**

## Consequences

### Good
- Swapping OpenAI for Anthropic, Google, Groq, or a local Ollama model is a `.env` edit.
- Running out of OpenAI credit mid-demo degrades gracefully to a free tier instead of failing.
- Cost is metered per call, per tenant, against a pricing table that is plain config.
- The eval harness can be independently judged, which makes its numbers defensible.
- Contributors only need the keys they actually have.

### Bad
- One more abstraction layer.
- Provider-specific features (prompt caching, extended thinking, structured tool use quirks) are harder to reach through a unified interface. Accepted: we are not using them yet.
- The pricing table must be maintained by hand. Unknown models record zero cost, which we log loudly.

## Alternatives considered

### Call the OpenAI SDK directly
Rejected. Ties the whole product to one vendor, one price, and one set of model names, in a market where all three change quarterly.

### LiteLLM proxy
Rejected for now. It solves the same problem but adds a service to run and a free tier to babysit, and we are optimising hard for zero infrastructure cost. Reconsider if we ever need >3 providers in production.
