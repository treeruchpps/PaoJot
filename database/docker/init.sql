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

-- ============================================================
-- ตาราง user_profiles
-- ============================================================
CREATE TABLE user_profiles (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name   VARCHAR(50),
    avatar_url     TEXT,
    week_start_day SMALLINT NOT NULL DEFAULT 1,  -- 0=อาทิตย์, 1=จันทร์, 6=เสาร์
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ENUM TYPES
-- ============================================================
CREATE TYPE account_type AS ENUM ('asset', 'liability');

CREATE TYPE account_kind AS ENUM (
    'cash',
    'bank_account',
    'savings',
    'investment',
    'e_wallet',
    'credit_card',
    'loan'
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

CREATE TYPE budget_period AS ENUM (
    'weekly',
    'monthly',
    'yearly'
);

-- ============================================================
-- ตาราง accounts
-- ============================================================
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

-- ============================================================
-- ตาราง categories
-- ============================================================
CREATE TABLE categories (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID             REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(100)     NOT NULL,
    type       transaction_type NOT NULL,
    icon       VARCHAR(50),
    color      VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ตาราง transactions
-- ============================================================
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

-- ============================================================
-- ตาราง savings_goals
-- ============================================================
CREATE TABLE savings_goals (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id     UUID           REFERENCES accounts(id) ON DELETE SET NULL,
    name           VARCHAR(100)   NOT NULL,
    target_amount  NUMERIC(15, 2) NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    deadline       DATE,
    status         goal_status    NOT NULL DEFAULT 'in_progress',
    note           TEXT,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ตาราง budgets
-- ============================================================
CREATE TABLE budgets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID           REFERENCES categories(id) ON DELETE SET NULL,
    name        VARCHAR(100)   NOT NULL,
    amount      NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    period      budget_period  NOT NULL DEFAULT 'monthly',
    start_date  DATE           NOT NULL,
    end_date    DATE,
    is_active   BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_budget_dates CHECK (end_date IS NULL OR end_date >= start_date)
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

-- ============================================================
-- ตาราง notifications
-- ============================================================
CREATE TABLE notifications (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recurring_id   UUID             REFERENCES recurring_transactions(id) ON DELETE CASCADE,
    budget_id      UUID             REFERENCES budgets(id) ON DELETE CASCADE,
    title          VARCHAR(200)     NOT NULL,
    message        TEXT,
    is_read        BOOLEAN          NOT NULL DEFAULT FALSE,
    action_taken   BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
CREATE INDEX idx_budgets_user_id             ON budgets(user_id);
CREATE INDEX idx_budgets_category_id         ON budgets(category_id);
CREATE INDEX idx_recurring_user_id           ON recurring_transactions(user_id);
CREATE INDEX idx_recurring_next_due          ON recurring_transactions(next_due_date);
CREATE INDEX idx_notifications_user_id       ON notifications(user_id);
CREATE INDEX idx_notifications_is_read       ON notifications(user_id, is_read);

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
    (uuid_generate_v4(), NULL, 'อาหารและเครื่องดื่ม', 'expense', 'UtensilsCrossed', '#f97316'),
    (uuid_generate_v4(), NULL, 'เครื่องแต่งกาย',      'expense', 'ShoppingBag',     '#ec4899'),
    (uuid_generate_v4(), NULL, 'ที่อยู่อาศัย',        'expense', 'Home',            '#84cc16'),
    (uuid_generate_v4(), NULL, 'การเดินทาง',           'expense', 'Car',             '#3b82f6'),
    (uuid_generate_v4(), NULL, 'การสื่อสาร',           'expense', 'Smartphone',      '#06b6d4'),
    (uuid_generate_v4(), NULL, 'บันเทิง',              'expense', 'Tv',              '#8b5cf6'),
    (uuid_generate_v4(), NULL, 'การศึกษา',             'expense', 'GraduationCap',   '#6366f1'),
    (uuid_generate_v4(), NULL, 'ของขวัญ',              'expense', 'Gift',            '#f59e0b'),
    (uuid_generate_v4(), NULL, 'การบริจาค',            'expense', 'Heart',           '#ef4444'),
    (uuid_generate_v4(), NULL, 'ของใช้',               'expense', 'Monitor',         '#94a3b8'),
    (uuid_generate_v4(), NULL, 'การแพทย์',             'expense', 'Shield',          '#ef4444'),
    (uuid_generate_v4(), NULL, 'การดูแลสุขภาพ',        'expense', 'Zap',             '#10b981'),
    (uuid_generate_v4(), NULL, 'การเงิน',              'expense', 'DollarSign',      '#6366f1'),
    (uuid_generate_v4(), NULL, 'ประกัน',               'expense', 'Landmark',        '#3b82f6'),
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
    (uuid_generate_v4(), NULL, 'ชำระบัตรเครดิต',       'transfer','CreditCard',      '#ef4444'),
    (uuid_generate_v4(), NULL, 'ฝากและถอน',            'transfer','PiggyBank',       '#10b981'),
    (uuid_generate_v4(), NULL, 'การยืมเงิน',           'transfer','Banknote',        '#f59e0b'),
    (uuid_generate_v4(), NULL, 'การให้ยืมเงิน',        'transfer','Wallet',          '#3b82f6'),
    (uuid_generate_v4(), NULL, 'การชำระคืน',           'transfer','Landmark',        '#f97316'),
    (uuid_generate_v4(), NULL, 'การเรียกเก็บหนี้',     'transfer','DollarSign',      '#ec4899'),
    (uuid_generate_v4(), NULL, 'อื่นๆ',                'transfer','Tag',             '#94a3b8');
