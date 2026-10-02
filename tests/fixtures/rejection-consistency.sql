-- Synthetic actual-column fixture with visit + deal trigger dependencies, never production records.
\ir deal-workflow.sql
-- These production defaults are essential: a direct rejection is interest, not inbound evidence.
ALTER TABLE property_inquiries ALTER COLUMN source SET DEFAULT 'other';
ALTER TABLE property_inquiries ALTER COLUMN first_inquiry_at SET DEFAULT now();
ALTER TABLE property_inquiries ALTER COLUMN last_inquiry_at SET DEFAULT now();
ALTER TABLE property_inquiries ALTER COLUMN inquiry_count SET DEFAULT 1;
ALTER TABLE property_inquiries ALTER COLUMN has_inbound_inquiry SET DEFAULT true;
ALTER TABLE property_inquiries ALTER COLUMN viewing_booked SET DEFAULT false;
ALTER TABLE property_inquiries ALTER COLUMN viewing_completed SET DEFAULT false;
ALTER TABLE property_inquiries ADD CONSTRAINT rejection_fixture_inquiry_count CHECK(inquiry_count>=1);
ALTER TABLE property_rejection_reasons ADD CONSTRAINT rejection_fixture_phase CHECK(phase IN('pre_visit','post_visit','unknown'));
GRANT SELECT,INSERT,UPDATE ON property_rejection_reasons TO authenticated;

ALTER TABLE rejection_reasons ADD CONSTRAINT rejection_fixture_company_code UNIQUE(company_id,code);
