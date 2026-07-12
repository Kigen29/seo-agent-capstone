# @seo/llm

Provider-agnostic LLM layer. **Application code never names a provider or a model. It asks for a role.**

## Usage

```ts
const fix = await llm.object({
  role: 'smart',              // not 'gpt-4.1'. not 'claude'. a ROLE.
  tenantId: tenant.id,
  schema: FixSchema,
  system: FIXER_SYSTEM_PROMPT,
  prompt: renderFinding(finding, fileContents),
})
```

## Configuration lives entirely in `.env`

```bash
LLM_FAST=openai:gpt-4.1-mini
LLM_SMART=openai:gpt-4.1
LLM_EMBED=openai:text-embedding-3-small
LLM_JUDGE=google:gemini-2.5-pro

OPENAI_API_KEY=sk-...
```

## Adding a key later, with zero code changes

Say your OpenAI credit runs out and you get a Groq key. You edit `.env`:

```bash
LLM_SMART=openai:gpt-4.1,groq:llama-3.3-70b-versatile
GROQ_API_KEY=gsk-...
```

Comma separated targets form an **ordered fallback chain**. On a rate limit, quota exhaustion, or a 5xx, the client falls through to the next target automatically.

Better still: `resolveChain` **silently drops any target whose API key is missing from the environment**. So you can commit a chain listing five providers, and each developer only needs the keys they actually have. Nothing breaks.

## Adding a whole new provider

If it is OpenAI-compatible (most are), you do not need to touch code at all:

```bash
LLM_FAST=custom:some-model@https://api.someprovider.com/v1
CUSTOM_LLM_API_KEY=...
```

If it needs a bespoke SDK, add one `case` to `src/providers.ts`. That is the only file in the entire codebase that knows a vendor SDK exists.

## Why `judge` is a separate role

The eval harness must be graded by a **different model family than the one under test**. If OpenAI grades OpenAI's output you get self-preference bias and your precision numbers lie to you. Keep `LLM_JUDGE` on a different provider. This is a methodological point worth defending in the design document.

## Cost control

`PRICING` in `src/pricing.ts` is plain config. Every call is metered and recorded against the tenant. The budget guard runs **before** the call, not after.

Remember the architecture: the rule engine finds the issue, the LLM only writes the fix. One `smart` call per *fixable finding*, not per page. A 500-page crawl with 14 fixable findings is 14 calls.
