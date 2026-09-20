<script setup lang="ts">
import { getTool } from '~/data/tools'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const tool = computed(() => getTool(slug.value))

if (!tool.value) {
  throw createError({ statusCode: 404, statusMessage: '工具不存在', fatal: true })
}

useSeo({
  title: computed(() => `在线${tool.value!.name} - 免登录 · DevKit`),
  description: computed(
    () => `${tool.value!.desc} 免注册免登录，在线即用；计算全部在浏览器本地完成，输入与结果不上传服务器，可离线使用。`
  )
})

const views = import.meta.glob<{ default: Component }>('../../components/tools/*.vue')
const view = computed(() => {
  const mod = views[`../../components/tools/${tool.value!.id}-${tool.value!.slug}.vue`]
  return mod ? defineAsyncComponent(mod as any) : null
})
</script>

<template>
  <ToolPageLayout v-if="tool && view" :tool="tool">
    <component :is="view" :tool="tool" />
    <ToolGuide :tool="tool" />
  </ToolPageLayout>
</template>
