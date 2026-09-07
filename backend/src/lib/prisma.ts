/** Single PrismaClient instance. Never `new PrismaClient()` anywhere else. */
import { PrismaClient } from '@prisma/client'
import { isProduction } from '../config/env.js'

export const prisma = new PrismaClient({
  log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
})
