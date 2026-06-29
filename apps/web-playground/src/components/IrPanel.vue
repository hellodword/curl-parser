<script setup lang="ts">
import { ref, watch } from "vue";
import { NButton, NEmpty, NTooltip } from "naive-ui";
import { Braces, Check, Copy } from "lucide-vue-next";

import { highlightJson } from "../highlight";

const props = defineProps<{
  json: string;
  busy: boolean;
}>();

const highlighted = ref("");
const copied = ref(false);
let highlightRun = 0;
let copyTimer: number | undefined;

watch(
  () => props.json,
  async () => {
    const run = ++highlightRun;
    highlighted.value = "";
    if (!props.json) {
      return;
    }
    const html = await highlightJson(props.json);
    if (run === highlightRun) {
      highlighted.value = html;
    }
  },
  { immediate: true },
);

async function copyIr(): Promise<void> {
  if (!props.json) {
    return;
  }
  await navigator.clipboard.writeText(props.json);
  copied.value = true;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1400);
}
</script>

<template>
  <section class="tab-surface" aria-label="intermediate representation">
    <header class="tab-toolbar">
      <div class="tab-title">
        <Braces :size="18" aria-hidden="true" />
        <span>IR</span>
      </div>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton size="small" :disabled="busy || !json" @click="copyIr">
            <template #icon>
              <Check v-if="copied" :size="16" aria-hidden="true" />
              <Copy v-else :size="16" aria-hidden="true" />
            </template>
            Copy
          </NButton>
        </template>
        Copy IR JSON
      </NTooltip>
    </header>

    <NEmpty v-if="!json" class="empty-state" description="No IR" />
    <div v-else class="code-frame" tabindex="0">
      <div v-if="highlighted" class="highlighted-code" v-html="highlighted"></div>
      <pre v-else class="plain-code">{{ json }}</pre>
    </div>
  </section>
</template>
