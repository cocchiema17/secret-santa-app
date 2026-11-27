<script setup lang="ts">
import { RouterView } from 'vue-router'
import Snowfall from '@/components/Snowfall.vue'
</script>

<template>
  <Snowfall />
  <RouterView />
</template>

<style>
body {
  margin: 0;
  padding: 0;
  background-color: #081c15;
}
</style>