-- First admin login. The password is temporary: it must be changed at first login.
INSERT INTO users (role, full_name, email, password_hash, must_change_password)
VALUES ('ADMIN', 'Platform Admin', 'lotusaiemail@gmail.com', '$2b$12$JAYyolLgd4VIjL9o1nVPUOajWS4d2FbN/UjEg14E0wda8PYW6GoHO', TRUE)
ON CONFLICT (email) DO NOTHING;
