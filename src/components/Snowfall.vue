<script setup lang="ts">
const flakes = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  left: `${(i * 4.2) % 100}%`,
  duration: `${8 + (i % 7) * 2}s`,
  delay: `-${(i % 5) * 2.5}s`,
  size: `${0.6 + (i % 4) * 0.25}rem`,
  opacity: 0.25 + (i % 4) * 0.15
}))
</script>

<template>
  <div class="snow-container" aria-hidden="true">
    <span
      v-for="f in flakes"
      :key="f.id"
      class="snowflake"
      :style="{
        left: f.left,
        animationDuration: f.duration,
        animationDelay: f.delay,
        fontSize: f.size,
        opacity: f.opacity
      }"
    >
      ❄
    </span>
  </div>
</template>

<style scoped>
.snow-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  overflow: hidden;
}

.snowflake {
  position: absolute;
  top: -2rem;
  color: #ffffff;
  user-select: none;
  animation-name: fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

@keyframes fall {
  0% {
    transform: translateY(-5vh) translateX(0px) rotate(0deg);
  }
  50% {
    transform: translateY(50vh) translateX(15px) rotate(180deg);
  }
  100% {
    transform: translateY(105vh) translateX(-10px) rotate(360deg);
  }
}
</style>