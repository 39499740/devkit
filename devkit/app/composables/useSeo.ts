import type { ComputedRef } from 'vue'
import { SITE_URL } from '~/utils/site'

interface SeoInput {
  title: string | ComputedRef<string>
  description: string | ComputedRef<string>
  /** 私有/空白页（收藏、最近使用、设置）不参与收录 */
  noindex?: boolean
}

/** 页面级 SEO：标题、描述、canonical 与 og 全部按当前路由生成，预渲染时逐页写进 HTML */
export function useSeo(input: SeoInput) {
  const route = useRoute()
  // 站点的真实可访问地址带尾斜杠（/tools/base64/），canonical 必须与之一致
  const url = computed(() => `${SITE_URL}${route.path.replace(/\/+$/, '')}/`)

  useSeoMeta({
    title: input.title,
    description: input.description,
    ogTitle: input.title,
    ogDescription: input.description,
    ogUrl: url,
    robots: input.noindex ? 'noindex,follow' : 'index,follow'
  })

  useHead({ link: [{ rel: 'canonical', href: url }] })
}
