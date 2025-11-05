-- AlterTable
ALTER TABLE "trainers"
ADD COLUMN     "user_id" UUID,
ADD CONSTRAINT "trainers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "trainers_user_id_key" ON "trainers"("user_id") WHERE "user_id" IS NOT NULL;

-- Backfill existing trainers to users
DO $$
DECLARE
    trainer_record RECORD;
    desired_last_name TEXT;
    desired_active BOOLEAN;
    matched_user_id UUID;
    matched_first_name TEXT;
    matched_last_name TEXT;
    matched_email TEXT;
    matched_role erp_role;
    matched_active BOOLEAN;
BEGIN
    FOR trainer_record IN
        SELECT trainer_id, name, apellido, email, activo
        FROM trainers
    LOOP
        IF trainer_record.email IS NULL OR btrim(trainer_record.email) = '' THEN
            CONTINUE;
        END IF;

        desired_last_name := COALESCE(trainer_record.apellido, '');
        desired_active := COALESCE(trainer_record.activo, TRUE);

        matched_user_id := NULL;
        matched_first_name := NULL;
        matched_last_name := NULL;
        matched_email := NULL;
        matched_role := NULL;
        matched_active := NULL;

        SELECT id, first_name, last_name, email, role, active
        INTO matched_user_id, matched_first_name, matched_last_name, matched_email, matched_role, matched_active
        FROM users
        WHERE lower(email) = lower(trainer_record.email)
        LIMIT 1;

        IF NOT FOUND THEN
            INSERT INTO users (first_name, last_name, email, role, active)
            VALUES (trainer_record.name, desired_last_name, trainer_record.email, 'formador'::erp_role, desired_active)
            RETURNING id, first_name, last_name, email, role, active
            INTO matched_user_id, matched_first_name, matched_last_name, matched_email, matched_role, matched_active;
        ELSE
            IF matched_first_name IS DISTINCT FROM trainer_record.name
               OR matched_last_name IS DISTINCT FROM desired_last_name
               OR matched_email IS DISTINCT FROM trainer_record.email
               OR matched_role IS DISTINCT FROM 'formador'::erp_role
               OR matched_active IS DISTINCT FROM desired_active THEN
                UPDATE users
                SET first_name = trainer_record.name,
                    last_name = desired_last_name,
                    email = trainer_record.email,
                    role = 'formador'::erp_role,
                    active = desired_active,
                    updated_at = now()
                WHERE id = matched_user_id
                RETURNING id, first_name, last_name, email, role, active
                INTO matched_user_id, matched_first_name, matched_last_name, matched_email, matched_role, matched_active;
            END IF;
        END IF;

        UPDATE trainers
        SET user_id = matched_user_id
        WHERE trainer_id = trainer_record.trainer_id
          AND (user_id IS DISTINCT FROM matched_user_id OR user_id IS NULL);
    END LOOP;
END
$$;

-- Synchronization functions and triggers
CREATE OR REPLACE FUNCTION public.fn_sync_trainer_to_user()
RETURNS TRIGGER AS $$
DECLARE
    desired_last_name TEXT;
    desired_active BOOLEAN;
    existing_user_id UUID;
    existing_first_name TEXT;
    existing_last_name TEXT;
    existing_email TEXT;
    existing_role erp_role;
    existing_active BOOLEAN;
BEGIN
    IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
        NEW.user_id := NULL;
        RETURN NEW;
    END IF;

    desired_last_name := COALESCE(NEW.apellido, '');
    desired_active := COALESCE(NEW.activo, TRUE);

    existing_user_id := NULL;
    existing_first_name := NULL;
    existing_last_name := NULL;
    existing_email := NULL;
    existing_role := NULL;
    existing_active := NULL;

    IF NEW.user_id IS NOT NULL THEN
        SELECT id, first_name, last_name, email, role, active
        INTO existing_user_id, existing_first_name, existing_last_name, existing_email, existing_role, existing_active
        FROM users
        WHERE id = NEW.user_id;
    END IF;

    IF existing_user_id IS NULL THEN
        SELECT id, first_name, last_name, email, role, active
        INTO existing_user_id, existing_first_name, existing_last_name, existing_email, existing_role, existing_active
        FROM users
        WHERE lower(email) = lower(NEW.email)
        LIMIT 1;
    END IF;

    IF existing_user_id IS NULL THEN
        INSERT INTO users (first_name, last_name, email, role, active)
        VALUES (NEW.name, desired_last_name, NEW.email, 'formador'::erp_role, desired_active)
        RETURNING id, first_name, last_name, email, role, active
        INTO existing_user_id, existing_first_name, existing_last_name, existing_email, existing_role, existing_active;
    ELSE
        IF existing_first_name IS DISTINCT FROM NEW.name
           OR existing_last_name IS DISTINCT FROM desired_last_name
           OR existing_email IS DISTINCT FROM NEW.email
           OR existing_role IS DISTINCT FROM 'formador'::erp_role
           OR existing_active IS DISTINCT FROM desired_active THEN
            UPDATE users
            SET first_name = NEW.name,
                last_name = desired_last_name,
                email = NEW.email,
                role = 'formador'::erp_role,
                active = desired_active,
                updated_at = now()
            WHERE id = existing_user_id
            RETURNING id, first_name, last_name, email, role, active
            INTO existing_user_id, existing_first_name, existing_last_name, existing_email, existing_role, existing_active;
        END IF;
    END IF;

    NEW.user_id := existing_user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_trainer_to_user ON trainers;
CREATE TRIGGER trg_sync_trainer_to_user
BEFORE INSERT OR UPDATE ON trainers
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_trainer_to_user();

CREATE OR REPLACE FUNCTION public.fn_sync_user_to_trainer()
RETURNS TRIGGER AS $$
DECLARE
    desired_apellido TEXT;
    existing_trainer_id TEXT;
    existing_name TEXT;
    existing_apellido TEXT;
    existing_email TEXT;
    existing_activo BOOLEAN;
    existing_user_id UUID;
BEGIN
    IF NEW.role <> 'formador'::erp_role THEN
        RETURN NEW;
    END IF;

    desired_apellido := NULLIF(NEW.last_name, '');

    existing_trainer_id := NULL;
    existing_name := NULL;
    existing_apellido := NULL;
    existing_email := NULL;
    existing_activo := NULL;
    existing_user_id := NULL;

    SELECT trainer_id, name, apellido, email, activo, user_id
    INTO existing_trainer_id, existing_name, existing_apellido, existing_email, existing_activo, existing_user_id
    FROM trainers
    WHERE user_id = NEW.id
    LIMIT 1;

    IF existing_trainer_id IS NULL AND NEW.email IS NOT NULL AND btrim(NEW.email) <> '' THEN
        SELECT trainer_id, name, apellido, email, activo, user_id
        INTO existing_trainer_id, existing_name, existing_apellido, existing_email, existing_activo, existing_user_id
        FROM trainers
        WHERE lower(email) = lower(NEW.email)
        LIMIT 1;
    END IF;

    IF existing_trainer_id IS NULL THEN
        INSERT INTO trainers (trainer_id, name, apellido, email, activo, user_id)
        VALUES (gen_random_uuid()::text, NEW.first_name, desired_apellido, NEW.email, NEW.active, NEW.id);
        RETURN NEW;
    END IF;

    IF existing_name IS DISTINCT FROM NEW.first_name
       OR COALESCE(existing_apellido, '') IS DISTINCT FROM COALESCE(desired_apellido, '')
       OR existing_email IS DISTINCT FROM NEW.email
       OR existing_activo IS DISTINCT FROM NEW.active
       OR existing_user_id IS DISTINCT FROM NEW.id THEN
        UPDATE trainers
        SET name = NEW.first_name,
            apellido = desired_apellido,
            email = NEW.email,
            activo = NEW.active,
            user_id = NEW.id,
            updated_at = now()
        WHERE trainer_id = existing_trainer_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_to_trainer ON users;
CREATE TRIGGER trg_sync_user_to_trainer
AFTER INSERT OR UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_user_to_trainer();
