<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NConfigProvider, NSpin, NTag } from "naive-ui";

import CommandPanel from "./components/CommandPanel.vue";
import ResultTabs from "./components/ResultTabs.vue";
import {
  defaultCommand,
  parseAndGenerate,
  shellOptions as loadShellOptions,
  targetOptions as loadTargetOptions,
} from "./parser-client";
import type {
  GenerateOutput,
  GeneratedFile,
  ParseOutput,
  PlaygroundStatus,
  ShellDialect,
  ShellParseResult,
  Target,
} from "./types";

const command = ref(defaultCommand);
const shell = ref<ShellDialect>("posix-sh");
const target = ref<Target>("js.fetch");
const status = ref<PlaygroundStatus>("Parsing");
const busy = ref(false);
const shellResult = ref<ShellParseResult | null>(null);
const parseResult = ref<ParseOutput | null>(null);
const generateResult = ref<GenerateOutput | null>(null);
const errorMessage = ref("");
const selectedPath = ref("");
const shellSelectOptions = loadShellOptions();
const targetSelectOptions = loadTargetOptions();
let debounceTimer: number | undefined;
let requestId = 0;

const generatedFiles = computed<GeneratedFile[]>(() => generateResult.value?.files ?? []);
const ready = computed(() => status.value === "Ready");
const visibleGeneratedFiles = computed<GeneratedFile[]>(() =>
  ready.value ? generatedFiles.value : [],
);
const irJson = computed(() => {
  const value = parseResult.value?.ir ?? parseResult.value;
  return value ? JSON.stringify(value, null, 2) : "";
});
const visibleIrJson = computed(() => (ready.value ? irJson.value : ""));
const visibleShellResult = computed(() => (ready.value ? shellResult.value : null));
const visibleParseResult = computed(() => (ready.value ? parseResult.value : null));
const visibleGenerateResult = computed(() => (ready.value ? generateResult.value : null));
const visibleErrorMessage = computed(() => (ready.value ? errorMessage.value : ""));
const statusType = computed<"default" | "success" | "warning" | "error" | "info">(() => {
  if (status.value === "Ready") {
    return "success";
  }
  if (status.value === "Parsing") {
    return "info";
  }
  if (status.value === "Parse failed") {
    return "warning";
  }
  if (status.value === "Error") {
    return "error";
  }
  return "default";
});

watch(
  visibleGeneratedFiles,
  (files) => {
    if (files.length === 0) {
      selectedPath.value = "";
      return;
    }
    if (!files.some((file) => file.path === selectedPath.value)) {
      selectedPath.value = files[0]?.path ?? "";
    }
  },
  { immediate: true },
);

async function updateResult(): Promise<void> {
  const trimmed = command.value.trim();
  const currentRequest = ++requestId;

  window.clearTimeout(debounceTimer);
  if (!trimmed) {
    status.value = "Enter a curl command";
    busy.value = false;
    shellResult.value = null;
    parseResult.value = null;
    generateResult.value = null;
    errorMessage.value = "";
    return;
  }

  status.value = "Parsing";
  busy.value = true;
  errorMessage.value = "";

  try {
    const result = await parseAndGenerate(trimmed, shell.value, target.value);
    if (currentRequest !== requestId) {
      return;
    }
    shellResult.value = result.shellResult;
    parseResult.value = result.parseResult;
    generateResult.value = result.generateResult;
    status.value = result.parseResult.ok ? "Ready" : "Parse failed";
  } catch (error) {
    if (currentRequest !== requestId) {
      return;
    }
    shellResult.value = null;
    parseResult.value = null;
    generateResult.value = null;
    errorMessage.value = error instanceof Error ? error.message : String(error);
    status.value = "Error";
  } finally {
    if (currentRequest === requestId) {
      busy.value = false;
    }
  }
}

function setSelectedPath(value: string): void {
  selectedPath.value = value;
}

watch(
  [command, shell, target],
  () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void updateResult();
    }, 250);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer);
});
</script>

<template>
  <NConfigProvider>
    <main class="workspace">
      <header class="app-header">
        <div class="title-block">
          <h1>curl-parser playground</h1>
          <NTag :type="statusType" :bordered="false">
            <NSpin v-if="busy" :size="12" />
            <span>{{ status }}</span>
          </NTag>
        </div>
      </header>

      <section class="workbench" aria-label="playground">
        <CommandPanel
          v-model:command="command"
          v-model:shell="shell"
          v-model:target="target"
          :shell-options="shellSelectOptions"
          :target-options="targetSelectOptions"
        />
        <section class="result-panel" aria-label="results">
          <ResultTabs
            :ready="ready"
            :files="visibleGeneratedFiles"
            :selected-path="selectedPath"
            :target="target"
            :ir-json="visibleIrJson"
            :busy="busy"
            :shell-result="visibleShellResult"
            :parse-result="visibleParseResult"
            :generate-result="visibleGenerateResult"
            :error-message="visibleErrorMessage"
            @update:selected-path="setSelectedPath"
          />
        </section>
      </section>
    </main>
  </NConfigProvider>
</template>
