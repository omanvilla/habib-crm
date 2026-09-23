-- Apply in the same transaction as conversation-forward.sql before new Edge code.
-- Lock both message tables while assigning new sequence columns. Existing unread
-- counts and business timestamps are intentionally preserved.
LOCK TABLE public.whatsapp_messages,public.whatsapp_conversations,public.instagram_messages,public.instagram_conversations IN SHARE ROW EXCLUSIVE MODE;
WITH numbered AS (
 SELECT id,row_number() OVER(PARTITION BY conversation_id ORDER BY created_at,id) seq FROM public.whatsapp_messages
)
UPDATE public.whatsapp_messages m SET ingestion_seq=n.seq,conversation_touched_at=coalesce(m.conversation_touched_at,m.created_at)
FROM numbered n WHERE m.id=n.id AND m.ingestion_seq IS NULL;
UPDATE public.whatsapp_conversations c SET last_message_seq=coalesce((SELECT max(ingestion_seq) FROM public.whatsapp_messages m WHERE m.conversation_id=c.id),0)
WHERE c.last_message_seq=0;
UPDATE public.whatsapp_conversations c SET read_through_seq=CASE WHEN coalesce(c.unread_count,0)=0 THEN c.last_message_seq ELSE
 coalesce((SELECT m.ingestion_seq FROM public.whatsapp_messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
 ORDER BY m.ingestion_seq DESC OFFSET greatest(coalesce(c.unread_count,0),0) LIMIT 1),0) END
WHERE c.read_through_seq=0;

WITH numbered AS (
 SELECT id,row_number() OVER(PARTITION BY conversation_id ORDER BY created_at,id) seq FROM public.instagram_messages
)
UPDATE public.instagram_messages m SET ingestion_seq=n.seq FROM numbered n WHERE m.id=n.id AND m.ingestion_seq IS NULL;
UPDATE public.instagram_conversations c SET last_message_seq=coalesce((SELECT max(ingestion_seq) FROM public.instagram_messages m WHERE m.conversation_id=c.id),0)
WHERE c.last_message_seq=0;
UPDATE public.instagram_conversations c SET read_through_seq=CASE WHEN coalesce(c.unread_count,0)=0 THEN c.last_message_seq ELSE
 coalesce((SELECT m.ingestion_seq FROM public.instagram_messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
 ORDER BY m.ingestion_seq DESC OFFSET greatest(coalesce(c.unread_count,0),0) LIMIT 1),0) END
WHERE c.read_through_seq=0;
