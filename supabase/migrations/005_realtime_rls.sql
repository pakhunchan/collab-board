DROP POLICY IF EXISTS "board_realtime_select" ON "realtime"."messages";
DROP POLICY IF EXISTS "board_realtime_insert" ON "realtime"."messages";

-- Board members (and all users on public boards) can receive broadcasts and presence
CREATE POLICY "board_realtime_select"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND (
    -- Public boards: any authenticated user
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE id::text = split_part((select realtime.topic()), ':', 2)
        AND visibility = 'public'
    )
    OR
    -- Private boards: must be a member
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE user_id = (select auth.jwt()->>'sub')
        AND board_id::text = split_part((select realtime.topic()), ':', 2)
    )
  )
);

-- Board members (and all users on public boards) can send broadcasts and presence
CREATE POLICY "board_realtime_insert"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE id::text = split_part((select realtime.topic()), ':', 2)
        AND visibility = 'public'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE user_id = (select auth.jwt()->>'sub')
        AND board_id::text = split_part((select realtime.topic()), ':', 2)
    )
  )
);
