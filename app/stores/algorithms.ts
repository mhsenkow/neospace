/**
 * Algorithm recipes — named, shareable filters over home/local/federated.
 * Device-local persistence; share via URL so others can import a curator’s feed.
 */

import { defineStore } from 'pinia'
import {
  builtinRecipes,
  decodeAlgorithmShare,
  encodeAlgorithmShare,
  normalizeKeywordList,
  normalizeTagList,
  sharePayloadToRecipe,
  type AlgorithmRecipe,
  type AlgorithmSource,
  type AlgorithmSharePayload,
} from '~/utils/algorithms'
import { useInstancesStore } from './instances'

const STORAGE_KEY = 'neospace_algorithms_v1'
const MAX_CUSTOM = 24

interface AlgorithmsState {
  recipes: AlgorithmRecipe[]
  hydrated: boolean
  /** Editor sheet */
  editorOpen: boolean
  editingId: string | null
}

function newId() {
  return `algo_${Math.random().toString(36).slice(2, 10)}`
}

function loadRecipes(): AlgorithmRecipe[] {
  if (typeof window === 'undefined') return builtinRecipes()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return builtinRecipes()
    const parsed = JSON.parse(raw) as { recipes?: AlgorithmRecipe[] }
    const custom = Array.isArray(parsed?.recipes) ? parsed.recipes.filter((r) => r && !r.builtin) : []
    const builtins = builtinRecipes()
    const byId = new Map<string, AlgorithmRecipe>()
    for (const b of builtins) byId.set(b.id, b)
    for (const c of custom.slice(0, MAX_CUSTOM)) {
      // Untrusted JSON — strings where the UI calls string methods, a real source
      if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name) continue
      if (c.source !== 'home' && c.source !== 'local' && c.source !== 'federated') continue
      byId.set(c.id, {
        ...c,
        description: typeof c.description === 'string' ? c.description : undefined,
        authorAcct: typeof c.authorAcct === 'string' ? c.authorAcct : undefined,
        authorName: typeof c.authorName === 'string' ? c.authorName : undefined,
        createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
        updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
        includeTags: normalizeTagList(c.includeTags),
        excludeTags: normalizeTagList(c.excludeTags),
        includeKeywords: normalizeKeywordList(c.includeKeywords),
        excludeKeywords: normalizeKeywordList(c.excludeKeywords),
        builtin: false,
      })
    }
    return [...byId.values()]
  } catch {
    return builtinRecipes()
  }
}

function saveCustom(recipes: AlgorithmRecipe[]) {
  if (typeof window === 'undefined') return
  const custom = recipes.filter((r) => !r.builtin).slice(0, MAX_CUSTOM)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, recipes: custom }))
  } catch {
    // Quota / private mode — keep the in-memory recipe rather than failing the save
  }
}

export const useAlgorithmsStore = defineStore('algorithms', {
  state: (): AlgorithmsState => ({
    recipes: builtinRecipes(),
    hydrated: false,
    editorOpen: false,
    editingId: null,
  }),

  getters: {
    customRecipes: (state): AlgorithmRecipe[] => state.recipes.filter((r) => !r.builtin),
    builtinList: (state): AlgorithmRecipe[] => state.recipes.filter((r) => r.builtin),
    allRecipes: (state): AlgorithmRecipe[] => state.recipes,
  },

  actions: {
    hydrate() {
      if (this.hydrated) return
      this.recipes = loadRecipes()
      this.hydrated = true
    },

    getRecipe(id: string | undefined | null): AlgorithmRecipe | null {
      if (!id) return null
      this.hydrate()
      return this.recipes.find((r) => r.id === id) || null
    },

    openEditor(id?: string | null) {
      this.hydrate()
      this.editingId = id ?? null
      this.editorOpen = true
    },

    closeEditor() {
      this.editorOpen = false
      this.editingId = null
    },

    upsert(input: {
      id?: string
      name: string
      description?: string
      source: AlgorithmSource
      mediaOnly?: boolean
      noReblogs?: boolean
      noReplies?: boolean
      includeTags?: string | string[]
      excludeTags?: string | string[]
      includeKeywords?: string | string[]
      excludeKeywords?: string | string[]
      authorAcct?: string
      authorName?: string
    }): AlgorithmRecipe | null {
      this.hydrate()
      const name = input.name.trim().slice(0, 48)
      if (!name) return null

      const now = Date.now()
      const existing = input.id ? this.recipes.find((r) => r.id === input.id) : null
      if (existing?.builtin) {
        // Fork builtin into a custom copy
        const forked: AlgorithmRecipe = {
          id: newId(),
          name,
          description: input.description?.trim().slice(0, 160) || undefined,
          source: input.source,
          mediaOnly: !!input.mediaOnly,
          noReblogs: !!input.noReblogs,
          noReplies: !!input.noReplies,
          includeTags: normalizeTagList(input.includeTags),
          excludeTags: normalizeTagList(input.excludeTags),
          includeKeywords: normalizeKeywordList(input.includeKeywords),
          excludeKeywords: normalizeKeywordList(input.excludeKeywords),
          authorAcct: input.authorAcct,
          authorName: input.authorName,
          createdAt: now,
          updatedAt: now,
        }
        if (this.customRecipes.length >= MAX_CUSTOM) return null
        this.recipes.push(forked)
        saveCustom(this.recipes)
        return forked
      }

      if (existing) {
        existing.name = name
        existing.description = input.description?.trim().slice(0, 160) || undefined
        existing.source = input.source
        existing.mediaOnly = !!input.mediaOnly
        existing.noReblogs = !!input.noReblogs
        existing.noReplies = !!input.noReplies
        existing.includeTags = normalizeTagList(input.includeTags)
        existing.excludeTags = normalizeTagList(input.excludeTags)
        existing.includeKeywords = normalizeKeywordList(input.includeKeywords)
        existing.excludeKeywords = normalizeKeywordList(input.excludeKeywords)
        if (input.authorAcct !== undefined) existing.authorAcct = input.authorAcct
        if (input.authorName !== undefined) existing.authorName = input.authorName
        existing.updatedAt = now
        saveCustom(this.recipes)
        return existing
      }

      if (this.customRecipes.length >= MAX_CUSTOM) return null
      const recipe: AlgorithmRecipe = {
        id: input.id || newId(),
        name,
        description: input.description?.trim().slice(0, 160) || undefined,
        source: input.source,
        mediaOnly: !!input.mediaOnly,
        noReblogs: !!input.noReblogs,
        noReplies: !!input.noReplies,
        includeTags: normalizeTagList(input.includeTags),
        excludeTags: normalizeTagList(input.excludeTags),
        includeKeywords: normalizeKeywordList(input.includeKeywords),
        excludeKeywords: normalizeKeywordList(input.excludeKeywords),
        authorAcct: input.authorAcct,
        authorName: input.authorName,
        createdAt: now,
        updatedAt: now,
      }
      this.recipes.push(recipe)
      saveCustom(this.recipes)
      return recipe
    },

    remove(id: string) {
      this.hydrate()
      const recipe = this.recipes.find((r) => r.id === id)
      if (!recipe || recipe.builtin) return
      this.recipes = this.recipes.filter((r) => r.id !== id)
      saveCustom(this.recipes)
    },

    /** Import a shared payload; returns the saved recipe */
    importShare(raw: string): AlgorithmRecipe | null {
      const payload = decodeAlgorithmShare(raw)
      if (!payload) return null
      return this.importPayload(payload)
    },

    importPayload(payload: AlgorithmSharePayload): AlgorithmRecipe {
      this.hydrate()
      const recipe = sharePayloadToRecipe(payload)
      // Dedupe by identical rules + name from same curator
      const twin = this.recipes.find(
        (r) =>
          !r.builtin &&
          r.name === recipe.name &&
          r.source === recipe.source &&
          !!r.mediaOnly === !!recipe.mediaOnly &&
          !!r.noReblogs === !!recipe.noReblogs &&
          !!r.noReplies === !!recipe.noReplies &&
          JSON.stringify(r.includeTags || []) === JSON.stringify(recipe.includeTags || []) &&
          JSON.stringify(r.excludeTags || []) === JSON.stringify(recipe.excludeTags || []) &&
          JSON.stringify(r.includeKeywords || []) === JSON.stringify(recipe.includeKeywords || []) &&
          JSON.stringify(r.excludeKeywords || []) === JSON.stringify(recipe.excludeKeywords || []),
      )
      if (twin) return twin
      if (this.customRecipes.length >= MAX_CUSTOM) {
        // Drop oldest custom to make room
        const oldest = [...this.customRecipes].sort((a, b) => a.createdAt - b.createdAt)[0]
        if (oldest) this.remove(oldest.id)
      }
      this.recipes.push(recipe)
      saveCustom(this.recipes)
      return recipe
    },

    encodeShare(id: string): string | null {
      const recipe = this.getRecipe(id)
      if (!recipe) return null
      const stamped = this.stampAuthor({ ...recipe })
      return encodeAlgorithmShare(stamped)
    },

    stampAuthor(recipe: AlgorithmRecipe): AlgorithmRecipe {
      const instances = useInstancesStore()
      const acct = instances.activeAccount
      if (!acct?.accessToken) return recipe
      const host = (() => {
        try {
          return new URL(acct.url).hostname
        } catch {
          return ''
        }
      })()
      const handle = acct.user?.acct || ''
      const full = handle.includes('@') ? handle : host ? `${handle}@${host}` : handle
      return {
        ...recipe,
        authorAcct: recipe.authorAcct || full || undefined,
        authorName: recipe.authorName || acct.user?.displayName || undefined,
      }
    },
  },
})
