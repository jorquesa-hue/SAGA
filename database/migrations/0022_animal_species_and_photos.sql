-- 0022_animal_species_and_photos.sql
-- Multi-species animal registration and a dated photo gallery per animal.
-- `species_code` was free text since 0001; this constrains it to the
-- supported species set. `animal_photo` is a soft-status metadata table (raw
-- bytes live in object storage, referenced by `storage_key`) so a wrongly
-- uploaded photo can be corrected with an explicit removal event rather than
-- a hard delete, matching the animal_restriction precedent (JK-DOM invariant
-- #2: corrections are explicit, not silent mutation).

-- ---------------------------------------------------------------------------
-- animal.species_code — constrain to the supported species set.
-- ---------------------------------------------------------------------------

ALTER TABLE animal
  ADD CONSTRAINT animal_species_code_check
  CHECK (species_code IN ('BOVINE', 'PORCINE', 'OVINE', 'CAPRINE', 'EQUINE'));

-- ---------------------------------------------------------------------------
-- animal_photo — dated photo gallery entry (JK-DOM-003: identity is stable
-- and independent of lifecycle status; photos document the animal across its
-- ages without replacing a single "profile" image).
-- ---------------------------------------------------------------------------

CREATE TABLE animal_photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  animal_id uuid NOT NULL,
  taken_at date NOT NULL,
  caption text,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  checksum_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_reason text,
  removed_at timestamptz,
  uploaded_by uuid,
  event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (animal_id, tenant_id) REFERENCES animal(id, tenant_id),
  UNIQUE (tenant_id, storage_key)
);

-- Gallery read: newest photo first per animal, active only.
CREATE INDEX animal_photo_animal_idx
  ON animal_photo(tenant_id, animal_id, taken_at DESC)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE animal_photo ENABLE ROW LEVEL SECURITY;
ALTER TABLE animal_photo FORCE ROW LEVEL SECURITY;

CREATE POLICY animal_photo_tenant_policy ON animal_photo
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jk_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON animal_photo TO jk_app';
  END IF;
END
$$;
