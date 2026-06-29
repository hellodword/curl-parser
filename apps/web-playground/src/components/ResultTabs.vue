<script setup lang="ts">
import { NTabs, NTabPane } from "naive-ui";

import type { GenerateOutput, GeneratedFile, ParseOutput, ShellParseResult, Target } from "../types";
import CodePanel from "./CodePanel.vue";
import DetailsPanel from "./DetailsPanel.vue";
import IrPanel from "./IrPanel.vue";

defineProps<{
  ready: boolean;
  files: GeneratedFile[];
  selectedPath: string;
  target: Target;
  irJson: string;
  busy: boolean;
  shellResult: ShellParseResult | null;
  parseResult: ParseOutput | null;
  generateResult: GenerateOutput | null;
  errorMessage: string;
}>();

const emit = defineEmits<{
  "update:selectedPath": [value: string];
}>();
</script>

<template>
  <NTabs class="result-tabs" type="line" animated pane-class="result-pane" default-value="details">
    <NTabPane name="details" tab="Details">
      <DetailsPanel
        v-if="ready"
        :shell-result="shellResult"
        :parse-result="parseResult"
        :generate-result="generateResult"
        :error-message="errorMessage"
      />
    </NTabPane>
    <NTabPane name="code" tab="Code">
      <CodePanel
        v-if="ready"
        :files="files"
        :selected-path="selectedPath"
        :target="target"
        :busy="busy"
        @update:selected-path="(value) => emit('update:selectedPath', value)"
      />
    </NTabPane>
    <NTabPane name="ir" tab="IR">
      <IrPanel v-if="ready" :json="irJson" :busy="busy" />
    </NTabPane>
  </NTabs>
</template>
