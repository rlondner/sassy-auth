import type { Config } from 'tailwindcss'
import uiConfig from '../../packages/ui/tailwind.config'

const config: Config = {
  presets: [uiConfig],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
}

export default config
