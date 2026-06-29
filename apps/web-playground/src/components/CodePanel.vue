<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NEmpty, NTooltip } from "naive-ui";
import { Check, Copy, FileCode } from "lucide-vue-next";

import { highlightCode, languageForFile } from "../highlight";
import type { GeneratedFile, Target } from "../types";
import FileSelector from "./FileSelector.vue";

const props = defineProps<{
  files: GeneratedFile[];
  selectedPath: string;
  target: Target;
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:selectedPath": [value: string];
}>();

const highlighted = ref("");
const copied = ref(false);
let highlightRun = 0;
let copyTimer: number | undefined;

const currentFile = computed(() => {
  return (
    props.files.find((file) => file.path === props.selectedPath) ??
    props.files[0] ??
    null
  );
});

const currentContent = computed(() => currentFile.value?.content ?? "");

watch(
  [currentFile, () => props.target],
  async () => {
    const run = ++highlightRun;
    const file = currentFile.value;
    if (!file) {
      highlighted.value = "";
      return;
    }
    highlighted.value = "";
    const html = await highlightCode(file.content, languageForFile(file.path, props.target));
    if (run === highlightRun) {
      highlighted.value = html;
    }
  },
  { immediate: true },
);

async function copyCurrentFile(): Promise<void> {
  if (!currentFile.value) {
    return;
  }
  await navigator.clipboard.writeText(currentFile.value.content);
  copied.value = true;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1400);
}
</script>

<template>
  <section class="tab-surface" aria-label="generated code">
    <header class="tab-toolbar">
      <div class="tab-title">
        <FileCode :size="18" aria-hidden="true" />
        <span>{{ currentFile?.path ?? "Code" }}</span>
      </div>
      <div class="tab-actions">
        <FileSelector
          :files="files"
          :selected-path="selectedPath"
          @update:selected-path="(value) => emit('update:selectedPath', value)"
        />
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton
              size="small"
              :disabled="busy || !currentFile"
              :focusable="Boolean(currentFile)"
              @click="copyCurrentFile"
            >
              <template #icon>
                <Check v-if="copied" :size="16" aria-hidden="true" />
                <Copy v-else :size="16" aria-hidden="true" />
              </template>
              Copy
            </NButton>
          </template>
          Copy current file
        </NTooltip>
      </div>
    </header>

    <NEmpty v-if="!currentFile" class="empty-state" description="No generated code" />
    <div v-else class="code-frame" tabindex="0">
      <div v-if="highlighted" class="highlighted-code" v-html="highlighted"></div>
      <pre v-else class="plain-code">{{ currentContent }}</pre>
    </div>
  </section>
</template>
