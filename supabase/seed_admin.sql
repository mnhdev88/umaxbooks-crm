-- Create admin user
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data,
  is_super_admin, confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'admin@umax.com',
  crypt('Admin@123', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"full_name":"Admin User","role":"admin"}'::jsonb,
  '{"provider":"email","providers":["email"]}'::jsonb,
  FALSE, '', '', '', ''
);
