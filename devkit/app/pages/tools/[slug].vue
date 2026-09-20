<script setup lang="ts">
import { getTool } from '~/data/tools'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const tool = computed(() => getTool(slug.value))

if (!tool.value) {
  throw createError({ statusCode: 404, statusMessage: '工具不存在', fatal: true })
}

useSeoMeta({
  title: computed(() => `${tool.value!.name} · DevKit`)
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
  </ToolPageLayout>
</template>
