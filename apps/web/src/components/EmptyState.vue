<script setup lang="ts">
defineProps<{ title: string; description: string; actionLabel?: string }>();
defineEmits<{ action: [] }>();
</script>

<template>
  <div class="empty">
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
    <button v-if="actionLabel" class="button secondary" type="button" @click="$emit('action')">{{ actionLabel }}</button>
  </div>
</template>
