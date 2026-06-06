CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ตาราง users
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(50)  UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    google_id     TEXT UNIQUE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ตาราง user_profiles

CREATE TABLE user_profiles (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name   VARCHAR(50),
    avatar_url     TEXT,
    week_start_day SMALLINT NOT NULL DEFAULT 1,  -- 0=อาทิตย์, 1=จันทร์, 6=เสาร์
    ai_summary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ai_summary_consent_at TIMESTAMP WITH TIME ZONE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ENUM TYPES

CREATE TYPE account_type AS ENUM ('asset');

CREATE TYPE account_kind AS ENUM (
    'cash',
    'bank_account',
    'savings',
    'investment',
    'e_wallet',
    'savings_goal'
);

CREATE TYPE transaction_type AS ENUM (
    'income',
    'expense',
    'transfer',
    'adjustment'
);

CREATE TYPE goal_status AS ENUM (
    'in_progress',
    'completed',
    'cancelled'
);

-- ตาราง accounts

CREATE TABLE accounts (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(100)   NOT NULL,
    type       account_type   NOT NULL,
    kind       account_kind   NOT NULL,
    balance    NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    currency   CHAR(3)        NOT NULL DEFAULT 'THB',
    is_active  BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ตาราง categories

CREATE TABLE categories (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID             REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(100)     NOT NULL,
    type       transaction_type NOT NULL,
    icon       VARCHAR(50),
    color      VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ตาราง transactions

CREATE TABLE transactions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id       UUID             NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_account_id    UUID             REFERENCES accounts(id),
    category_id      UUID             REFERENCES categories(id) ON DELETE SET NULL,
    type             transaction_type NOT NULL,
    amount           NUMERIC(15, 2)   NOT NULL CHECK (amount > 0),
    name             VARCHAR(100),
    note             TEXT,
    transaction_date DATE             NOT NULL DEFAULT CURRENT_DATE,
    is_recurring     BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ตาราง savings_goals

CREATE TABLE savings_goals (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id     UUID           REFERENCES accounts(id) ON DELETE SET NULL,
    name           VARCHAR(100)   NOT NULL,
    image_url      TEXT,
    target_amount  NUMERIC(15, 2) NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (current_amount >= 0),
    start_date     DATE           NOT NULL DEFAULT CURRENT_DATE,
    deadline       DATE,
    status         goal_status    NOT NULL DEFAULT 'in_progress',
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ตาราง budgets

CREATE TABLE budgets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID           REFERENCES categories(id) ON DELETE SET NULL,
    amount      NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    budget_type VARCHAR(20)    NOT NULL DEFAULT 'month' CHECK (budget_type IN ('week', 'month', 'year', 'custom')),
    start_date  DATE           NOT NULL,
    end_date    DATE           NOT NULL,
    is_recurring BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
);

-- ============================================================
-- ตาราง recurring_transactions
-- ============================================================
CREATE TYPE recur_frequency AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

CREATE TABLE recurring_transactions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id     UUID             NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_account_id  UUID             REFERENCES accounts(id),
    category_id    UUID             REFERENCES categories(id) ON DELETE SET NULL,
    type           transaction_type NOT NULL,
    amount         NUMERIC(15, 2)   NOT NULL CHECK (amount > 0),
    name           VARCHAR(100),
    note           TEXT,
    frequency      recur_frequency  NOT NULL DEFAULT 'monthly',
    day_of_month   SMALLINT,        -- สำหรับ monthly: 1-31
    day_of_week    SMALLINT,        -- สำหรับ weekly: 0=อาทิตย์ 6=เสาร์
    next_due_date  DATE             NOT NULL,
    is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ตาราง notifications

CREATE TABLE notifications (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recurring_id   UUID             REFERENCES recurring_transactions(id) ON DELETE CASCADE,
    budget_id      UUID             REFERENCES budgets(id) ON DELETE CASCADE,
    goal_id        UUID             REFERENCES savings_goals(id) ON DELETE CASCADE,
    notification_type VARCHAR(50)    NOT NULL DEFAULT 'recurring',
    title          VARCHAR(200)     NOT NULL,
    message        TEXT,
    is_read        BOOLEAN          NOT NULL DEFAULT FALSE,
    action_taken   BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ตาราง slip_jobs (batch OCR jobs)
-- ============================================================
CREATE TABLE slip_jobs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_count INT  NOT NULL DEFAULT 0,
    done_count  INT  NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ตาราง slip_results (each slip in a job)
-- ============================================================
CREATE TABLE slip_results (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id           UUID NOT NULL REFERENCES slip_jobs(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           VARCHAR(20) NOT NULL DEFAULT 'queued',
    filename         VARCHAR(255),
    image_path       TEXT,
    ocr_text         TEXT,
    bank             VARCHAR(100),
    amount           NUMERIC(15,2) DEFAULT 0,
    transaction_date DATE,
    transaction_time VARCHAR(10),
    sender           VARCHAR(255),
    receiver         VARCHAR(255),
    ref_no           VARCHAR(255),
    is_duplicate     BOOLEAN NOT NULL DEFAULT FALSE,
    error_msg        TEXT,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ตาราง slip_ref_log (duplicate ref_no detection)
-- ============================================================
CREATE TABLE slip_ref_log (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ref_no         VARCHAR(255) NOT NULL,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, ref_no)
);

-- image_path บน transactions (เก็บ path รูปสลิปที่แนบมา)
ALTER TABLE transactions ADD COLUMN image_path TEXT;

-- ============================================================
-- ตาราง receipt_jobs (async OCR สำหรับใบเสร็จแบบ batch)
-- ============================================================
CREATE TABLE receipt_jobs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_count INT NOT NULL DEFAULT 0,
    done_count  INT NOT NULL DEFAULT 0,
    filename    VARCHAR(255),
    image_path  TEXT,
    result_json TEXT,
    error_msg   TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE receipt_results (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id      UUID NOT NULL REFERENCES receipt_jobs(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'queued',
    filename    VARCHAR(255),
    image_path  TEXT,
    ocr_text    TEXT,
    result_json TEXT,
    error_msg   TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Unified scan jobs (receipt/slip auto classification)
-- ============================================================
CREATE TABLE scan_jobs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_count INT NOT NULL DEFAULT 0,
    done_count  INT NOT NULL DEFAULT 0,
    error_msg   TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE scan_results (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id         UUID NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status         VARCHAR(20) NOT NULL DEFAULT 'queued',
    document_type  VARCHAR(20) NOT NULL DEFAULT 'unknown',
    filename       VARCHAR(255),
    image_path     TEXT,
    ocr_text       TEXT,
    result_json    JSONB,
    is_duplicate   BOOLEAN NOT NULL DEFAULT FALSE,
    error_msg      TEXT,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ตาราง ai_summaries (cache สรุปการเงินจาก LLM)
-- ============================================================
CREATE TABLE ai_summaries (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_type    VARCHAR(20) NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
    period_start   DATE        NOT NULL,
    period_end     DATE        NOT NULL,
    week_start_day SMALLINT    NOT NULL DEFAULT 1,
    model          TEXT        NOT NULL,
    data_hash      TEXT        NOT NULL,
    summary_json   JSONB       NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, period_type, period_start, period_end, week_start_day)
);

-- ============================================================
-- ตาราง quick_entry_chat_logs (ประวัติแชทผู้ช่วยบันทึกเร็ว แยกตามผู้ใช้และโหมด)
-- ============================================================
CREATE TABLE quick_entry_chat_logs (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode       VARCHAR(20) NOT NULL CHECK (mode IN ('income', 'expense', 'saving', 'transfer', 'chat')),
    messages   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, mode)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_users_email           ON users(email);
CREATE INDEX idx_users_username        ON users(username);
CREATE INDEX idx_accounts_user_id      ON accounts(user_id);
CREATE INDEX idx_transactions_user_id  ON transactions(user_id);
CREATE INDEX idx_transactions_account  ON transactions(account_id);
CREATE INDEX idx_transactions_date     ON transactions(transaction_date);
CREATE INDEX idx_savings_goals_user_id ON savings_goals(user_id);
CREATE INDEX idx_savings_goals_status  ON savings_goals(status);
CREATE UNIQUE INDEX idx_savings_goals_user_name_unique ON savings_goals(user_id, LOWER(name));
CREATE INDEX idx_budgets_user_id             ON budgets(user_id);
CREATE INDEX idx_budgets_category_id         ON budgets(category_id);
CREATE INDEX idx_budgets_user_type           ON budgets(user_id, budget_type);
CREATE INDEX idx_recurring_user_id           ON recurring_transactions(user_id);
CREATE INDEX idx_recurring_next_due          ON recurring_transactions(next_due_date);
CREATE INDEX idx_notifications_user_id       ON notifications(user_id);
CREATE INDEX idx_notifications_is_read       ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_type          ON notifications(user_id, notification_type, created_at);
CREATE INDEX idx_receipt_jobs_user_id         ON receipt_jobs(user_id);
CREATE INDEX idx_receipt_results_job_id       ON receipt_results(job_id);
CREATE INDEX idx_scan_jobs_user_id            ON scan_jobs(user_id);
CREATE INDEX idx_scan_results_job_id          ON scan_results(job_id);
CREATE INDEX idx_slip_jobs_user_id           ON slip_jobs(user_id);
CREATE INDEX idx_slip_results_job_id         ON slip_results(job_id);
CREATE INDEX idx_slip_ref_log_user           ON slip_ref_log(user_id, ref_no);
CREATE INDEX idx_ai_summaries_user_period    ON ai_summaries(user_id, period_type, period_start, period_end);
CREATE INDEX idx_quick_entry_chat_logs_user  ON quick_entry_chat_logs(user_id, mode);

-- ============================================================
-- FUNCTION + TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_receipt_jobs_updated_at
    BEFORE UPDATE ON receipt_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_receipt_results_updated_at
    BEFORE UPDATE ON receipt_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_slip_jobs_updated_at
    BEFORE UPDATE ON slip_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_slip_results_updated_at
    BEFORE UPDATE ON slip_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_ai_summaries_updated_at
    BEFORE UPDATE ON ai_summaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_quick_entry_chat_logs_updated_at
    BEFORE UPDATE ON quick_entry_chat_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_savings_goals_updated_at
    BEFORE UPDATE ON savings_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_budgets_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_recurring_updated_at
    BEFORE UPDATE ON recurring_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TRIGGER: สร้าง user_profiles อัตโนมัติเมื่อ insert users
-- ============================================================
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (user_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_user_profile
    AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION create_user_profile();

-- ============================================================
-- DEFAULT CATEGORIES
-- ============================================================
INSERT INTO categories (id, user_id, name, type, icon, color) VALUES
    -- รายจ่าย (expense) — เรียงตามลำดับที่กำหนด
    (uuid_generate_v4(), NULL, 'อาหาร',               'expense', 'UtensilsCrossed', '#f97316'),
    (uuid_generate_v4(), NULL, 'เดินทาง',              'expense', 'Car',             '#3b82f6'),
    (uuid_generate_v4(), NULL, 'ของใช้',               'expense', 'Package',         '#64748b'),
    (uuid_generate_v4(), NULL, 'ช้อปปิ้ง',             'expense', 'ShoppingBag',     '#ec4899'),
    (uuid_generate_v4(), NULL, 'บันเทิง',              'expense', 'Gamepad2',        '#8b5cf6'),
    (uuid_generate_v4(), NULL, 'ที่อยู่อาศัย',        'expense', 'Home',            '#84cc16'),
    (uuid_generate_v4(), NULL, 'ชำระบิล',              'expense', 'ReceiptText',     '#06b6d4'),
    (uuid_generate_v4(), NULL, 'สุขภาพ',               'expense', 'HeartPulse',      '#10b981'),
    (uuid_generate_v4(), NULL, 'ครอบครัว',             'expense', 'Users',           '#f59e0b'),
    (uuid_generate_v4(), NULL, 'สัตว์เลี้ยง',          'expense', 'PawPrint',        '#5F9A7A'),
    (uuid_generate_v4(), NULL, 'ของขวัญ',              'expense', 'Gift',            '#f59e0b'),
    (uuid_generate_v4(), NULL, 'การบริจาค',            'expense', 'HandHeart',       '#ef4444'),
    (uuid_generate_v4(), NULL, 'การศึกษา',             'expense', 'GraduationCap',   '#6366f1'),
    (uuid_generate_v4(), NULL, 'ท่องเที่ยว',           'expense', 'Plane',           '#2C6488'),
    (uuid_generate_v4(), NULL, 'งาน',                  'expense', 'BriefcaseBusiness','#475569'),
    (uuid_generate_v4(), NULL, 'ลงทุน',                'expense', 'TrendingUp',      '#5F9A7A'),
    (uuid_generate_v4(), NULL, 'ชำระหนี้',             'expense', 'CreditCard',      '#2C6488'),
    (uuid_generate_v4(), NULL, 'อื่นๆ',                'expense', 'Tag',             '#94a3b8'),
    -- รายรับ (income)
    (uuid_generate_v4(), NULL, 'เงินเดือน',            'income',  'Briefcase',       '#10b981'),
    (uuid_generate_v4(), NULL, 'รายได้พิเศษ',          'income',  'Star',            '#f59e0b'),
    (uuid_generate_v4(), NULL, 'โบนัส',                'income',  'Gift',            '#6366f1'),
    (uuid_generate_v4(), NULL, 'ค่าล่วงเวลา',          'income',  'Zap',             '#f97316'),
    (uuid_generate_v4(), NULL, 'การลงทุน',             'income',  'DollarSign',      '#3b82f6'),
    (uuid_generate_v4(), NULL, 'อื่นๆ',                'income',  'Tag',             '#94a3b8'),
    -- การโอน (transfer)
    (uuid_generate_v4(), NULL, 'โอนผ่านธนาคาร',        'transfer','ArrowLeftRight',  '#6366f1'),
    (uuid_generate_v4(), NULL, 'ฝากและถอน',            'transfer','PiggyBank',       '#10b981'),
    (uuid_generate_v4(), NULL, 'การยืมเงิน',           'transfer','Banknote',        '#f59e0b'),
    (uuid_generate_v4(), NULL, 'การให้ยืมเงิน',        'transfer','Wallet',          '#3b82f6'),
    (uuid_generate_v4(), NULL, 'การชำระคืน',           'transfer','Landmark',        '#f97316'),
    (uuid_generate_v4(), NULL, 'อื่นๆ',                'transfer','Tag',             '#94a3b8');
