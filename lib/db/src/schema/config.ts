import { pgTable, text } from "drizzle-orm/pg-core";

export const configStore = pgTable("config_store", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
