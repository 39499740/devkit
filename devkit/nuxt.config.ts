const SITE_URL = 'https://www.t502.fun'
const SITE_NAME = 'DevKit'
const SITE_DESC =
  'DevKit 是面向 Java、Web、Vue 开发者的浏览器本地工具箱：JSON、编码、摘要加密、国密、时间、Java、前端与文件处理全部在本地完成，可静态部署。'

const prefsBootScript = `(function(){var e=document.documentElement;var m=false;try{m=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)}catch(_){}var p=null;try{var r=localStorage.getItem('devkit.prefs.v1');if(r)p=JSON.parse(r)}catch(_){}try{if(!p||typeof p!=='object')p=null;var t=p&&p.theme;e.classList.toggle('dark',t==='dark'||(t!=='light'&&m));var s=p&&p.codeFontSize;if(typeof s==='number'&&isFinite(s)&&s>0)e.style.setProperty('--code-font-size',s+'px');var rm=!!(p&&p.reduceMotion);e.classList.toggle('reduce-motion',rm);if(rm){if(document.body)document.body.classList.add('reduce-motion');else document.addEventListener('DOMContentLoaded',function(){if(document.body)document.body.classList.add('reduce-motion')})}}catch(_){}})();`

// 访问统计（站长统计）：默认关闭，只有同时给出 provider 与标识时才会在浏览器端加载脚本。
// 构建/部署时用环境变量打开，例如：
//   DEVKIT_ANALYTICS=baidu DEVKIT_ANALYTICS_ID=12345678 npm run generate
// 说明见 docs/ANALYTICS.md；访客开关入口在「偏好设置 → 匿名访问统计」。
const ANALYTICS_PROVIDER = (process.env.DEVKIT_ANALYTICS || '').trim()
const ANALYTICS_ID = (process.env.DEVKIT_ANALYTICS_ID || '').trim()

// 监听地址：默认绑定所有网卡（0.0.0.0），局域网内其它设备可直接访问。
// 只想本机访问时用 DEVKIT_HOST=localhost（或 NUXT_HOST / NITRO_HOST / HOST）覆盖。
const devHost =
  process.env.DEVKIT_HOST || process.env.NUXT_HOST || process.env.NITRO_HOST || process.env.HOST || '0.0.0.0'
const devPort = Number(
  process.env.DEVKIT_PORT || process.env.NUXT_PORT || process.env.NITRO_PORT || process.env.PORT || 3000
)

export default defineNuxtConfig({
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },
  devServer: {
    host: devHost,
    port: devPort
  },
  css: [
    '@fontsource/noto-sans-sc/400.css',
    '@fontsource/noto-sans-sc/500.css',
    '@fontsource/noto-sans-sc/600.css',
    '@fontsource/noto-sans-sc/700.css',
    '@fontsource/jetbrains-mono/400.css',
    '@fontsource/jetbrains-mono/500.css',
    '@fontsource/jetbrains-mono/600.css',
    '~/assets/css/main.css'
  ],
  ssr: true,
  runtimeConfig: {
    public: {
      siteUrl: SITE_URL,
      analytics: { provider: ANALYTICS_PROVIDER, siteId: ANALYTICS_ID }
    }
  },
  nitro: {
    prerender: {
      routes: ['/sitemap.xml']
    }
  },
  modules: ['@vite-pwa/nuxt'],
  vite: {
    plugins: [
      {
        name: 'devkit-fontsource-woff2-only',
        enforce: 'pre',
        transform(code: string, id: string) {
          if (!id.includes('@fontsource') || !/\.css(\?|$)/.test(id)) return null
          const stripped = code.replace(/,\s*url\([^)]*\.woff\)\s*format\((['"])woff\1\)/g, '')
          if (stripped === code) return null
          return { code: stripped, map: null }
        }
      }
    ]
  },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'DevKit · 开发者本地工具箱',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#F4F5F7' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: SITE_NAME },
        { property: 'og:image', content: `${SITE_URL}/pwa-512.png` },
        { name: 'twitter:card', content: 'summary' }
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/pwa-192.png' },
        { rel: 'apple-touch-icon', href: '/pwa-192.png' },
      ],
      script: [
        {
          innerHTML: prefsBootScript,
          tagPosition: 'head',
          tagPriority: 'critical'
        }
      ]
    }
  },
  pwa: {
    registerType: 'autoUpdate',
    devOptions: { enabled: false },
    manifest: {
      name: 'DevKit',
      short_name: 'DevKit',
      description: '面向 Java、Web、Vue 开发者的浏览器本地工具箱，数据全部在本地处理。',
      lang: 'zh-CN',
      dir: 'ltr',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      theme_color: '#F4F5F7',
      background_color: '#F4F5F7',
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      navigateFallback: '',
      manifestTransforms: [
        async (entries: unknown[]) => ({ manifest: entries as never[], warnings: [] })
      ],
      runtimeCaching: [
        {
          urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'devkit-pages',
            networkTimeoutSeconds: 4,
            precacheFallback: { fallbackURL: '/offline-fallback.html' },
            cacheableResponse: { statuses: [0, 200] },
            expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 }
          }
        },
        {
          urlPattern: ({ url }: { url: URL }) => /\.woff2$/.test(url.pathname),
          handler: 'CacheFirst',
          options: {
            cacheName: 'devkit-fonts',
            cacheableResponse: { statuses: [0, 200] },
            expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 365 }
          }
        }
      ]
    }
  }
})
