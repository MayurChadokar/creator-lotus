-- Showing creator posts on the company's own pages.
ALTER TABLE campaigns ADD COLUMN collab_account TEXT;
ALTER TABLE submissions ADD COLUMN collab_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE submissions ADD COLUMN shared_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN shared_by UUID REFERENCES users(id);
UPDATE campaigns SET collab_account = '@lotuselectronics' WHERE title = 'SAMPLE Diwali TV reviews';
