// src/middleware/authMiddleware.js
import jwt from 'jsonwebtoken'

export function authMiddleware(req, res, next) {
  // DEBUG: Check if JWT_SECRET is loaded
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'placeholder') {
    console.error('FATAL: JWT_SECRET is missing or is the placeholder value!')
    return res.status(500).json({ error: 'server_error', message: 'Server configuration error: Missing JWT_SECRET' })
  }

  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Authorization header' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = { id: decoded.userId || decoded.id, email: decoded.email }
    next()
  } catch (error) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' })
  }
}
