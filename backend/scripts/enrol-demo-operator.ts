import { enrolOperator } from '../src/control/control-service.js'
import { prisma } from '../src/lib/prisma.js'

async function main() {
  const existing = await prisma.operator.findUnique({ where: { externalId: 'demo-operator' } })
  if (existing) {
    console.log('ALREADY_ENROLLED', existing.id)
    return
  }
  const enrolled = await enrolOperator({
    externalId: 'demo-operator',
    displayName: 'Console Demo Operator',
  })
  console.log(JSON.stringify(enrolled))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
