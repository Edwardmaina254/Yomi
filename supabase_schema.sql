-- Manga titles
create table public.mangas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  synopsis text,
  cover_url text,
  format text check (format in ('manga', 'manhwa', 'manhua')) default 'manga',
  created_at timestamptz default now()
);

-- Chapters table
create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  manga_id uuid references public.mangas(id) on delete cascade not null,
  chapter_number numeric not null,
  title text,
  source_url text not null,
  created_at timestamptz default now()
);

-- User reading progress & bookmarks
create table public.reading_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  chapter_id uuid references public.chapters(id) on delete cascade not null,
  page_number int default 1,
  completed boolean default false,
  updated_at timestamptz default now(),
  unique(user_id, chapter_id)
);
