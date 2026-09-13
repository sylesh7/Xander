import {
  Gauge,
  Database,
  Bot,
  FileSignature,
  Siren,
  Coins,
  Scale3d,
  Activity,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Pages not yet built in this stage — linked but show a "not built yet" state. */
  stub?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/console', label: 'Overview', icon: Gauge },
  { href: '/console/evidence', label: 'Evidence', icon: Database },
  { href: '/console/agents', label: 'Agents', icon: Bot },
  { href: '/console/intents', label: 'Intents', icon: FileSignature, stub: true },
  { href: '/console/incidents', label: 'Incidents', icon: Siren, stub: true },
  { href: '/console/commerce', label: 'Commerce', icon: Coins, stub: true },
  { href: '/console/policy', label: 'Policy', icon: Scale3d, stub: true },
  { href: '/console/system', label: 'System', icon: Activity },
]
