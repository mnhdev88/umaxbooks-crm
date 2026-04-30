-- Add GMB URL to leads (Google Maps place link saved after scraping)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS gmb_url TEXT;

-- Add score and scrape snapshot to audits
ALTER TABLE audits ADD COLUMN IF NOT EXISTS score INTEGER;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS scrape_data JSONB;

-- Store original uploaded file names
ALTER TABLE audits ADD COLUMN IF NOT EXISTS file_names JSONB;
