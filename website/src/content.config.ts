import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    tag: z.string().optional(),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
