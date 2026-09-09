import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.concierge.app',
  appName: 'Concierge',
  webDir: '.output/public',
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
