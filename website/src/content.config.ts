import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    seoTitle: z.string().optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    locale: z.enum(["zh", "en"]).default("zh"),
    translationKey: z.string().optional(),
    summary: z.string(),
    tag: z.string().optional(),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
