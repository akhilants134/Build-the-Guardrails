// src/services/aiService.js
import fetch from 'node-fetch'

const SYSTEM_PROMPT = `You are an expert job description analyser. 
Analyse the provided job description and return ONLY a JSON object with these exact fields:
{
  "title": "inferred job title",
  "experienceLevel": "junior OR mid OR senior OR lead",
  "requiredSkills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
  "responsibilities": ["responsibility1", "responsibility2", "responsibility3"],
  "salaryRange": "estimated range based on role and level, e.g. $80k-$120k",
  "industryType": "inferred industry",
  "remotePolicy": "remote OR hybrid OR onsite OR unspecified"
}
Return ONLY valid JSON. No markdown. No explanation text.`

export async function analyzeJobDescription(text, userId) {
  // Guardrail 2 — Create AbortController BEFORE setting the timeout
  const controller = new AbortController()

  // Guardrail 2 — Set 15-second timeout; fires abort() if LLM is too slow
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, 15000)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://jobscan.app',
        'X-Title': 'JobScan AI'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        max_tokens: 600,
        temperature: 0.2
      }),
      signal: controller.signal  // Guardrail 2 — connect abort signal to fetch
    })

    // Guardrail 2 — CRITICAL: cancel timeout on success so it doesn't fire later
    clearTimeout(timeoutId)

    const data = await response.json()

    // Token logging
    if (data.usage) {
      console.log('[AI_USAGE]', JSON.stringify({
        timestamp: new Date().toISOString(),
        userId,
        model: 'openai/gpt-4o-mini',
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        endpoint: 'analyze_job_description'
      }))
    }

    // Guardrail 3 — If the provider returned an error object, data.choices will
    // be undefined. Access it defensively so we throw into the catch below.
    if (!data.choices || !data.choices[0]) {
      throw new Error(`LLM returned no choices. Status: ${response.status}. Body: ${JSON.stringify(data)}`)
    }

    const content = data.choices[0].message.content

    try {
      return JSON.parse(content)
    } catch {
      return {
        title: 'Unknown',
        experienceLevel: 'unknown',
        requiredSkills: [],
        responsibilities: [],
        salaryRange: 'unspecified',
        industryType: 'unknown',
        remotePolicy: 'unspecified',
        rawContent: content
      }
    }

  } catch (err) {
    // Guardrail 2 — CRITICAL: always clear the timeout in catch too
    clearTimeout(timeoutId)

    if (err.name === 'AbortError') {
      // Guardrail 2 — Timeout triggered. Log and return fallback, not 500.
      console.error('[AI_TIMEOUT]', JSON.stringify({
        timestamp: new Date().toISOString(),
        userId,
        timeoutMs: 15000
      }))
      return {
        success: false,
        fallback: true,
        message: 'Analysis unavailable. Please try again shortly.'
      }
    }

    // Guardrail 3 — Any other LLM error (network failure, bad API key, quota
    // exceeded, malformed JSON, etc.). Log and return fallback — never crash.
    console.error('[AI_ERROR]', JSON.stringify({
      timestamp: new Date().toISOString(),
      userId,
      error: err.message
    }))
    return {
      success: false,
      fallback: true,
      message: 'Analysis unavailable. Please try again shortly.'
    }
  }
}
