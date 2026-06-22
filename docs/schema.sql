-- =====================================================
-- 1. Users table
-- =====================================================
CREATE TABLE accounts_user (
    id SERIAL PRIMARY KEY,
    username VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(128) NOT NULL,
    is_staff BOOLIUM,
    email VARCHAR(254) NOT NULL UNIQUE,
    first_name VARCHAR(150),
    last_name VARCHAR(150),
    phone VARCHAR(15),
    date_joined TIMESTAMPTZ DEFAULT NOW()
);


-- =====================================================
-- 2. Greenhouses table
-- =====================================================
CREATE TABLE greenhouses_greenhouse (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL
        REFERENCES accounts_user(id) ON DELETE CASCADE,
    serial_number VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','active','offline')),
    api_token VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- =====================================================
-- 3. Sensor Data table
-- =====================================================
CREATE TABLE greenhouses_sensordata (
    id BIGSERIAL PRIMARY KEY,
    greenhouse_id INTEGER NOT NULL
        REFERENCES greenhouses_greenhouse(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),

    temperature FLOAT NOT NULL,
    humidity FLOAT NOT NULL,
    soil_moisture FLOAT,
    light_intensity FLOAT,

    battery FLOAT  -- battery voltage or percentage
);


-- =====================================================
-- 4. Device State table (1:1)
-- =====================================================
CREATE TABLE greenhouses_devicestate (
    greenhouse_id INTEGER PRIMARY KEY
        REFERENCES greenhouses_greenhouse(id) ON DELETE CASCADE,

    fan BOOLEAN NOT NULL DEFAULT FALSE,
    water_pump BOOLEAN NOT NULL DEFAULT FALSE,
    light BOOLEAN NOT NULL DEFAULT FALSE,

    energy_state VARCHAR(10)
        CHECK (energy_state IN ('battery','grid')),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- =====================================================
-- 5. Schedules table
-- =====================================================
CREATE TABLE schedules_schedule (
    id SERIAL PRIMARY KEY,

    greenhouse_id INTEGER NOT NULL
        REFERENCES greenhouses_greenhouse(id) ON DELETE CASCADE,

    device_type VARCHAR(20) NOT NULL
        CHECK (device_type IN ('fan','pump','light')),

    condition_type VARCHAR(10) NOT NULL
        CHECK (condition_type IN ('time','sensor')),

    -- Time-based
    time_of_day TIME,

    -- Sensor-based
    sensor_name VARCHAR(20)
        CHECK (sensor_name IN ('temperature','humidity','soil_moisture','light_intensity')),

    operator VARCHAR(5)
        CHECK (operator IN ('>','<','>=','<=','==')),

    threshold FLOAT,

    action VARCHAR(3) NOT NULL
        CHECK (action IN ('on','off')),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Business logic constraint
    CONSTRAINT check_condition_validity CHECK (
        (
            condition_type = 'time'
            AND time_of_day IS NOT NULL
            AND sensor_name IS NULL
            AND operator IS NULL
            AND threshold IS NULL
        )
        OR
        (
            condition_type = 'sensor'
            AND time_of_day IS NULL
            AND sensor_name IS NOT NULL
            AND operator IS NOT NULL
            AND threshold IS NOT NULL
        )
    )
);


-- =====================================================
-- Indexes (optimized, cleaned)
-- =====================================================

CREATE INDEX idx_sensordata_greenhouse_timestamp
ON greenhouses_sensordata (greenhouse_id, timestamp DESC);

CREATE INDEX idx_sensordata_timestamp
ON greenhouses_sensordata (timestamp);

CREATE INDEX idx_greenhouses_owner_status
ON greenhouses_greenhouse (owner_id, status);


-- =====================================================
-- Auto update updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_greenhouse_updated_at
BEFORE UPDATE ON greenhouses_greenhouse
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();