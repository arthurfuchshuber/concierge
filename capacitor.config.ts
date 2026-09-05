import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.anfitriaosigma.guia',
  appName: 'ConciergeIA',
  webDir: '.output/public',
  server: {
    url: 'https://anfitriaosigma.com.br',
    cleartext: true
  }
};

export default config;