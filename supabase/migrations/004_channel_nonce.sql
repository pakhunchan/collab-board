ALTER TABLE boards ADD COLUMN channel_nonce uuid NOT NULL DEFAULT gen_random_uuid();
