-- Sprint 2, STORY-016: detect every stack, including Angular and bare Vue SPAs.
-- The framework enum is generated from frameworkSchema, so adding those two values there means
-- the database enum has to learn them too, or storing a detected 'angular'/'vue_spa' would fail.
-- IF NOT EXISTS keeps it idempotent; ADD VALUE runs outside the migration's use of the value.
ALTER TYPE "framework" ADD VALUE IF NOT EXISTS 'vue_spa';
ALTER TYPE "framework" ADD VALUE IF NOT EXISTS 'angular';
