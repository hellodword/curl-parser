<script setup lang="ts">
import { computed } from "vue";
import { NAlert, NEmpty, NTag } from "naive-ui";
import { AlertTriangle, Info } from "lucide-vue-next";

import { explainCommand } from "../explain-command";
import type { Diagnostic, GenerateOutput, ParseOutput, ShellParseResult } from "../types";

const props = defineProps<{
  shellResult: ShellParseResult | null;
  parseResult: ParseOutput | null;
  generateResult: GenerateOutput | null;
  errorMessage: string;
}>();

const messages = computed<Diagnostic[]>(() => [
  ...(props.shellResult?.diagnostics ?? []),
  ...(props.parseResult?.diagnostics ?? []),
  ...(props.generateResult?.diagnostics ?? []),
]);

const externalRefs = computed(() => {
  const value = props.parseResult?.ir?.externalRefs;
  return Array.isArray(value) ? value : [];
});

const explanations = computed(() => explainCommand(props.shellResult, props.parseResult));

function tagType(severity?: string): "default" | "info" | "warning" | "error" {
  if (severity === "error") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  if (severity === "info") {
    return "info";
  }
  return "default";
}

function messageSource(message: Diagnostic): string {
  const source = message.source;
  if (!source) {
    return "";
  }
  const span =
    source.start === undefined || source.end === undefined
      ? ""
      : ` ${source.start}-${source.end}`;
  const argv =
    source.argvIndex === undefined ? "" : ` argv ${source.argvIndex}`;
  return `${source.source}${argv}${span}`;
}
</script>

<template>
  <section class="details-surface" aria-label="details">
    <NAlert v-if="errorMessage" type="error" :show-icon="false" class="detail-alert">
      {{ errorMessage }}
    </NAlert>

    <section class="detail-section">
      <h2>Command</h2>
      <NEmpty
        v-if="explanations.length === 0"
        class="empty-state compact"
        description="No parsed arguments"
      />
      <article
        v-for="item in explanations"
        v-else
        :key="item.id"
        class="detail-row"
        :class="`is-${item.severity}`"
      >
        <div class="detail-icon">
          <AlertTriangle v-if="item.severity === 'error'" :size="17" aria-hidden="true" />
          <Info v-else :size="17" aria-hidden="true" />
        </div>
        <div class="detail-body">
          <div class="detail-heading">
            <code>{{ item.displayToken }}</code>
            <NTag size="small" :bordered="false">argv {{ item.argvIndex }}</NTag>
            <NTag
              v-if="item.sourceToken && item.sourceToken !== item.displayToken"
              size="small"
              :bordered="false"
            >
              from {{ item.sourceToken }}
            </NTag>
            <NTag v-if="item.canonical" size="small" :bordered="false" type="info">
              {{ item.canonical }}
            </NTag>
          </div>
          <strong>{{ item.title }}</strong>
          <p>{{ item.description }}</p>
          <p v-for="ref in item.externalRefs ?? []" :key="`${item.id}-${ref.id}`">
            External {{ ref.kind ?? "input" }} {{ ref.value ?? ref.option ?? ref.id }}.
          </p>
        </div>
      </article>
    </section>

    <section class="detail-section">
      <h2>Messages</h2>
      <NEmpty
        v-if="messages.length === 0"
        class="empty-state compact"
        description="No messages"
      />
      <article v-for="message in messages" :key="`${message.code}-${message.message}`" class="message-row">
        <NTag size="small" :bordered="false" :type="tagType(message.severity)">
          {{ message.severity }}
        </NTag>
        <div>
          <strong>{{ message.code }}</strong>
          <p>{{ message.message ?? "" }}</p>
          <small>{{ messageSource(message) }}</small>
        </div>
      </article>
    </section>

    <section class="detail-section">
      <h2>External refs</h2>
      <NEmpty
        v-if="externalRefs.length === 0"
        class="empty-state compact"
        description="No external refs"
      />
      <article v-for="ref in externalRefs" :key="ref.id" class="message-row">
        <NTag size="small" :bordered="false" type="info">{{ ref.kind }}</NTag>
        <div>
          <strong>{{ ref.value ?? ref.option ?? ref.id }}</strong>
          <p>{{ ref.access }}</p>
        </div>
      </article>
    </section>
  </section>
</template>
