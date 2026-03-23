import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const slidesTable = pgTable("slides", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  tagline: text("tagline").notNull(),
  summary: text("summary").notNull(),
  imageUrl: text("image_url"),
  imagePrompt: text("image_prompt"),
  category: text("category"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSlideSchema = createInsertSchema(slidesTable).omit({ id: true, createdAt: true });
export type InsertSlide = z.infer<typeof insertSlideSchema>;
export type Slide = typeof slidesTable.$inferSelect;
