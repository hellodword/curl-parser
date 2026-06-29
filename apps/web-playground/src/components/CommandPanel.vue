<script setup lang="ts">
import { NCard, NInput, NSelect } from "naive-ui";
import type { SelectOption } from "naive-ui";

import type { ShellDialect, Target } from "../types";

defineProps<{
  command: string;
  shell: ShellDialect;
  target: Target;
  shellOptions: SelectOption[];
  targetOptions: SelectOption[];
}>();

const emit = defineEmits<{
  "update:command": [value: string];
  "update:shell": [value: ShellDialect];
  "update:target": [value: Target];
}>();
</script>

<template>
  <NCard class="command-card" content-class="command-card-content" :bordered="false">
    <div class="control-grid">
      <label class="control-field">
        <span>Shell</span>
        <NSelect
          :value="shell"
          :options="shellOptions"
          @update:value="(value) => emit('update:shell', value as ShellDialect)"
        />
      </label>
      <label class="control-field">
        <span>Target</span>
        <NSelect
          :value="target"
          :options="targetOptions"
          @update:value="(value) => emit('update:target', value as Target)"
        />
      </label>
    </div>

    <label class="control-field command-field">
      <span>Curl command</span>
      <NInput
        type="textarea"
        :value="command"
        :autosize="{ minRows: 9, maxRows: 18 }"
        spellcheck="false"
        @update:value="(value) => emit('update:command', value)"
      />
    </label>
  </NCard>
</template>
