<script setup lang="ts">
import { computed } from "vue";
import { NSelect } from "naive-ui";

import type { GeneratedFile } from "../types";

const props = defineProps<{
  files: GeneratedFile[];
  selectedPath: string;
}>();

const emit = defineEmits<{
  "update:selectedPath": [value: string];
}>();

const options = computed(() =>
  props.files.map((file) => ({
    label: file.path,
    value: file.path,
  })),
);
</script>

<template>
  <NSelect
    v-if="files.length > 1"
    class="file-selector"
    size="small"
    :options="options"
    :value="selectedPath"
    @update:value="(value) => emit('update:selectedPath', String(value))"
  />
</template>
