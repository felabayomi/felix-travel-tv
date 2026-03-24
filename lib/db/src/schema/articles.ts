import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  source: text("source"),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const snippetsTable = pgTable("snippets", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull().references(() => articlesTable.id, { onDelete: "cascade" }),
  snippetOrder: integer("snippet_order").notNull().default(0),
  headline: text("headline").notNull(),
  caption: text("caption").notNull(),
  explanation: text("explanation").notNull(),
  imageUrl: text("image_url"),
  imagePrompt: text("image_prompt"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({ id: true, createdAt: true });
export const insertSnippetSchema = createInsertSchema(snippetsTable).omit({ id: true, createdAt: true });

export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type InsertSnippet = z.infer<typeof insertSnippetSchema>;
export type Article = typeof articlesTable.$inferSelect;
export type Snippet = typeof snippetsTable.$inferSelect;
