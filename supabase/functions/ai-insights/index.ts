/* ============================================================
   ai-insights — the shop's briefing goes in, an assessment comes out

   The Anthropic key lives here, in the function's secrets, and never in a
   browser. ShopFlow runs on shared shop tablets; a key in localStorage is a
   key anyone standing at the machine can read.

   This is deliberately NOT a general Claude proxy. It accepts one shape — a
   briefing object — and supplies its own model, system prompt and output
   schema. Otherwise the shop's own login would double as free API credit for
   anything at all, billed to them.

   Deploy:
     supabase functions deploy ai-insights --project-ref niveinyzkkwtreeeaziv
     supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
   The caller must present a valid Supabase session (the shop login), which is
   what Supabase's own JWT verification enforces before this code runs.
   ============================================================ */

const MODEL = "claude-opus-5";
const MAX_BRIEFING_BYTES = 200_000;      // a shop's numbers, not a data dump

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are a manufacturing operations advisor with 25 years on the floor of
furniture and cabinet shops — the kind that runs 5 to 30 people, cuts sheet goods, edges,
drills, assembles and installs. You have run production yourself and you have seen every
way a shop this size loses money.

You are given a factual briefing generated from one shop's own production system: their
jobs, stations, hours, materials, deliveries and customers. Read it like a shop owner
handed you their numbers and asked what you think.

Answer three things, in this order:

1. What is genuinely good. Be honest, not encouraging — if a number is strong, say why it
   matters. If nothing is strong, say that plainly rather than inventing praise.
2. What is costing them. Rank by what actually hurts: late delivery, idle capacity,
   material shortages stopping work, estimates that misprice future quotes, jobs quietly
   going nowhere. Name the specific job, material, station or customer from the briefing.
3. What to do, in the order you would do it. Concrete steps a shop this size can take this
   week — not "implement lean manufacturing". Say what changes and what they should expect
   to see if it works.

Rules you must follow:
- Use only what is in the briefing. Never invent a number, a job or a name.
- When a figure is missing or zero because nothing was tracked, say the tracking is the
  problem — do not read it as a result.
- Quote the evidence for every claim, using the shop's own numbers and identifiers.
- Small samples mean weak conclusions. If they finished three jobs, say so before drawing
  a trend from them.
- Write like you are talking to the owner: short, direct, no consultancy vocabulary.`;

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence: the state of this shop right now." },
    confidence: {
      type: "string", enum: ["high", "medium", "low"],
      description: "How much the data supports these conclusions. Low when the sample is small or little was tracked.",
    },
    confidence_note: { type: "string", description: "Why that confidence — name the limitation." },
    strengths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string", description: "The figures from the briefing that support it." },
        },
        required: ["title", "detail", "evidence"],
        additionalProperties: false,
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          detail: { type: "string" },
          evidence: { type: "string" },
          cost: { type: "string", description: "What this is costing them, in their own terms." },
        },
        required: ["title", "severity", "detail", "evidence", "cost"],
        additionalProperties: false,
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          effort: { type: "string", enum: ["today", "this week", "this month"] },
          expect: { type: "string", description: "What they should see if it worked." },
        },
        required: ["title", "detail", "effort", "expect"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "confidence", "confidence_note", "strengths", "issues", "steps"],
  additionalProperties: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY is not set on this function" }, 500);

  let briefing: unknown;
  try {
    const body = await req.json();
    briefing = body?.briefing;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!briefing || typeof briefing !== "object") return json({ error: "No briefing" }, 400);

  const text = JSON.stringify(briefing);
  if (text.length > MAX_BRIEFING_BYTES)
    return json({ error: `Briefing is ${text.length} bytes; the limit is ${MAX_BRIEFING_BYTES}` }, 413);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // a policy decline should degrade to another model rather than return nothing
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
        fallbacks: "default",
        messages: [{
          role: "user",
          content: "Here is the briefing from the shop's production system.\n\n```json\n" + text + "\n```",
        }],
      }),
    });
  } catch (e) {
    return json({ error: "Could not reach the Claude API: " + (e as Error).message }, 502);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    return json({ error: `Claude API ${res.status}`, detail }, 502);
  }

  const msg = await res.json();
  /* A refusal is an HTTP 200 with no usable content — check before reading it. */
  if (msg.stop_reason === "refusal")
    return json({ error: "The request was declined", detail: msg.stop_details?.explanation || "" }, 422);

  const block = (msg.content || []).find((b: { type: string }) => b.type === "text");
  if (!block) return json({ error: "No text in the reply" }, 502);

  let insight: unknown;
  try {
    insight = JSON.parse(block.text);
  } catch {
    return json({ error: "The reply was not the JSON we asked for" }, 502);
  }

  return json({
    ok: true, insight,
    model: msg.model,
    usage: {
      input: msg.usage?.input_tokens ?? null,
      output: msg.usage?.output_tokens ?? null,
    },
  });
});
