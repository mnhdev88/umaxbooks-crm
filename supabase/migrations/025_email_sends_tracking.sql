-- Link email_sends to email_tracking so EmailHistory can show open status
alter table email_sends add column if not exists tracking_token uuid;
