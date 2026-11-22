import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const pwaManifest = {
  id: '/',
  name: 'SHINE CAB — Bike, Auto & Cab',
  short_name: 'SHINE CAB',
  description:
    'Real-time Bike, Auto & Cab ride booking with live GPS tracking and verified drivers.',
  theme_color: '#FFC928',
  background_color: '#111111',
  display: 'standalone' as const,
  start_url: '/',
  scope: '/',
  icons: [
    {
      src: '/pwa-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

export default defineConfig(() => {
  return { base: "./",
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: pwaManifest,
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,woff,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        // Disabled in dev because HMR/WebSockets are off in preview;
        // production build still generates sw.js + registerSW.js + manifest.
        devOptions: {
          enabled: false,
        },
      }),
      {
        name: 'serve-dev-webmanifest',
        apply: 'serve',
        transformIndexHtml(html: string) {
          if (html.includes('rel="manifest"')) return html;
          return html.replace('</head>', '  <link rel="manifest" href="/manifest.webmanifest" />\n  </head>');
        },
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/manifest.webmanifest') {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/manifest+json');
              res.end(JSON.stringify(pwaManifest, null, 2));
              return;
            }
            next();
          });
        },
      },
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: false,
      ws: false as const,
      allowedHosts: true as const,
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
