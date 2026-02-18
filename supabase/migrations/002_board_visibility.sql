ALTER TABLE boards
  ADD COLUMN visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));

CREATE INDEX idx_board_members_user_id ON board_members(user_id);
