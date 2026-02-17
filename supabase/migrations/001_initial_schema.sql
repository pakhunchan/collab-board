-- Boards
create table boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Board members
create table board_members (
  board_id uuid not null references boards(id) on delete cascade,
  user_id text not null,
  display_name text,
  role text not null default 'editor',
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

-- Board objects (sticky notes, shapes, etc.)
create table board_objects (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  type text not null,
  x double precision not null default 0,
  y double precision not null default 0,
  width double precision not null default 200,
  height double precision not null default 200,
  rotation double precision not null default 0,
  text text,
  color text,
  z_index integer not null default 0,
  properties jsonb not null default '{}',
  created_by text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_board_objects_board_id on board_objects(board_id);
create index idx_board_objects_updated_at on board_objects(updated_at);
