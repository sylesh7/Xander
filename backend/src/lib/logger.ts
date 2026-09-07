/** Shared pino logger. Both tracks import this rather than console.log. */
import pino from 'pino'
import { env, isProduction } from '../config/env.js'

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug',
  ...(isProduction ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
})
