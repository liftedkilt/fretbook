-- Lessons are experimental (issue #434): a per-user switch, off by default. Existing rows read as off.

ALTER TABLE users ADD COLUMN lessons_enabled INTEGER NOT NULL DEFAULT 0;
