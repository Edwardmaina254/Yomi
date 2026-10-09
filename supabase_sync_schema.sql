-- Run this script in the Supabase SQL Editor to enable Library Sync

-- 1. Create a table to store the user's unified library and continue reading JSON blobs
CREATE TABLE IF NOT EXISTS public.user_sync_data (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  library_data JSONB DEFAULT '[]'::jsonb,
  continue_data JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.user_sync_data ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies so users can only read/write their own data
CREATE POLICY "Users can view own sync data" 
  ON public.user_sync_data 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync data" 
  ON public.user_sync_data 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync data" 
  ON public.user_sync_data 
  FOR UPDATE 
  USING (auth.uid() = user_id);

-- 4. Create an upsert function to easily handle frontend sync operations
CREATE OR REPLACE FUNCTION sync_user_data(
  p_user_id UUID,
  p_library_data JSONB,
  p_continue_data JSONB
) RETURNS void AS $$
BEGIN
  INSERT INTO public.user_sync_data (user_id, library_data, continue_data, updated_at)
  VALUES (p_user_id, p_library_data, p_continue_data, CURRENT_TIMESTAMP)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    library_data = EXCLUDED.library_data,
    continue_data = EXCLUDED.continue_data,
    updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
