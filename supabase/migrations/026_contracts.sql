-- Contracts table for e-signature agreements
CREATE TABLE IF NOT EXISTS contracts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  created_by          uuid REFERENCES profiles(id) NOT NULL,
  signing_token       uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  status              text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','signed','cancelled')),

  -- Client info (snapshot at time of sending)
  business_name       text NOT NULL,
  contact_person      text,
  address             text,
  city                text,
  state               text,
  zip_code            text,
  phone               text,
  client_email        text NOT NULL,

  -- Service details (admin fills)
  package             text,
  project_name        text,
  start_date          date,
  delivery_timeline   text,
  payment_type        text,
  total_amount        numeric,

  -- Payment details (client fills on signing page)
  name_on_card        text,
  card_type           text,
  card_last_4         text,
  first_payment       numeric,
  installment_payment numeric,
  balance_payment     numeric,

  -- Admin / rep signature
  rep_name            text,
  rep_title           text,
  rep_sign_date       date,
  rep_signature       text,   -- base64 PNG data URL

  -- Client signature (filled after signing)
  client_full_name    text,
  client_sign_date    date,
  client_signature    text,   -- base64 PNG data URL
  client_ip           text,

  -- Final signed PDF
  signed_pdf_url      text,

  sent_at             timestamptz DEFAULT now(),
  signed_at           timestamptz,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Admins have full access
CREATE POLICY "Admins full access on contracts" ON contracts
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- Sales agents can view contracts on their leads
CREATE POLICY "Sales agents view own lead contracts" ON contracts
  FOR SELECT USING (
    get_my_role() IN ('agent','sales_agent')
    AND EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = contracts.lead_id
        AND leads.assigned_agent_id = auth.uid()
    )
  );
