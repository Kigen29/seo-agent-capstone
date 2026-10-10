import { AppearanceSettings } from './appearance'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Appearance' }

/** Appearance is the default section: it is the one setting most people come here to change. */
export default function SettingsAppearancePage() {
  return <AppearanceSettings />
}
