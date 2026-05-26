// src/controllers/analyzeController.js
import { analyzeJobDescription } from '../services/aiService.js'

export async function analyzeController(req, res) {
  const { text } = req.body

  // Guardrail 1 — Input validation: empty check
  if (!text || text.trim().length === 0) {
    return res.status(400).json({
      error: 'input_required',
      message: 'Job description text is required.'
    })
  }

  // Guardrail 1 — Input length validation
  // 3000 chars ≈ 750 tokens. Enough for any real job description.
  // Anything longer is either paste-spam or a cost attack.
  if (text.length > 3000) {
    return res.status(400).json({
      error: 'input_too_long',
      limit: 3000,
      received: text.length
    })
    // The AI service is NOT called here — no [AI_USAGE] log will appear
  }

  // Only reaches here if input is valid
  const result = await analyzeJobDescription(text, req.user.id)

  // Guardrail 3 — Detect fallback from aiService and return 503
  if (result?.fallback === true) {
    return res.status(503).json(result)
  }

  res.status(200).json({
    success: true,
    analysis: result,
    characterCount: text.length
  })
}
