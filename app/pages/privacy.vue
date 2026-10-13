<script setup lang="ts">
/**
 * Public privacy page for App Store Connect / marketing URL.
 */
useHead({
  title: 'Privacy | NeoSpace',
  meta: [
    {
      name: 'description',
      content: 'How NeoSpace handles your data — local-first Fediverse client.',
    },
  ],
})

definePageMeta({
  layout: false,
})
</script>

<template>
  <main class="privacy">
    <header class="privacy__head">
      <NuxtLink to="/" class="privacy__mark" aria-label="NeoSpace home">NS</NuxtLink>
      <h1>Privacy</h1>
      <p class="privacy__lede">
        NeoSpace is a Fediverse client. Your posts and identity live on the Mastodon (or
        compatible) server you choose — not on a NeoSpace account database.
      </p>
    </header>

    <section class="privacy__section">
      <h2>What stays on your device</h2>
      <ul>
        <li>OAuth tokens and account profiles for servers you sign into</li>
        <li>Drafts, board columns, appearance, and local preferences</li>
        <li>Optional search history (you can turn “Remember searches” off)</li>
      </ul>
    </section>

    <section class="privacy__section">
      <h2>What leaves your device</h2>
      <ul>
        <li>
          API requests to the Fediverse servers you use (timelines, posts, media, follows) —
          governed by each server’s own policies
        </li>
        <li>
          Optional “leave a note” feedback you submit (rate-limited; no password or token
          attached)
        </li>
      </ul>
    </section>

    <section class="privacy__section">
      <h2>Analytics &amp; tracking</h2>
      <p>
        NeoSpace does not embed third-party advertising or analytics SDKs. Fonts are self-hosted.
      </p>
    </section>

    <section class="privacy__section">
      <h2>iOS App Store build</h2>
      <p>
        The native shell loads the same client bundled with the app. Sign-in uses your chosen
        Mastodon server’s OAuth page; NeoSpace does not create a separate NeoSpace login.
      </p>
    </section>

    <section class="privacy__section">
      <h2>Contact</h2>
      <p>
        Questions:
        <a href="https://github.com/mhsenkow/neospace" rel="noopener noreferrer" target="_blank">
          github.com/mhsenkow/neospace
        </a>
      </p>
    </section>

    <p class="privacy__updated">Last updated 2026-10-13</p>
  </main>
</template>

<style scoped lang="scss">
.privacy {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
  color: var(--neo-text-primary);
  font-family: var(--neo-font-family);
  line-height: 1.5;
}

.privacy__head {
  margin-bottom: 2rem;
}

.privacy__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  margin-bottom: 1rem;
  border-radius: 0.35rem;
  background: var(--neo-accent);
  color: var(--neo-text-on-accent, #111);
  font-weight: 700;
  text-decoration: none;
}

.privacy__lede {
  color: var(--neo-text-secondary);
}

.privacy__section {
  margin-bottom: 1.5rem;

  h2 {
    font-size: 1.05rem;
    margin: 0 0 0.5rem;
  }

  ul {
    margin: 0;
    padding-left: 1.2rem;
  }

  a {
    color: var(--neo-accent);
  }
}

.privacy__updated {
  margin-top: 2rem;
  font-size: 0.85rem;
  color: var(--neo-text-muted);
}
</style>
