import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, MessageCircle, PiggyBank, Send, Sparkles, X } from 'lucide-react';
import { fmt } from '../../constants/data';
import { quickEntry, savingsGoals, transactions } from '../../services/api';

const todayStr = () => new Date().toISOString().slice(0, 10);

const MODE_META = {
  expense: { label: 'รายจ่าย', tone: '#ef4444', bg: '#fff1f2', placeholder: 'กาแฟ 50' },
  income: { label: 'รายรับ', tone: '#10b981', bg: '#f0fdf4', placeholder: 'เงินเดือน 30000' },
  saving: { label: 'การออม', tone: '#2C6488', bg: '#EAF3F7', placeholder: 'ออม 500' },
};

const MAX_CHAT_LOG_MESSAGES = 80;
const messageId = () => crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const firstBotMessage = (mode) => ({
  id: messageId(),
  role: 'bot',
  text: `พิมพ์รายการ${MODE_META[mode].label}ได้เลย เช่น "${MODE_META[mode].placeholder}"`,
});

const serializeMessage = (message) => {
  if (message.role === 'preview') {
    return {
      id: message.id,
      role: 'preview',
      readonly: true,
      mode: message.mode,
      result: {
        title: message.result?.title || '',
        amount: Number(message.result?.amount || 0),
      },
      account: message.account ? { name: message.account.name } : null,
      goal: message.goal ? { name: message.goal.name } : null,
      category: message.category ? { name: message.category.name } : null,
    };
  }
  return {
    id: message.id,
    role: message.role,
    text: message.text || '',
    success: !!message.success,
  };
};

export default function QuickEntryPanel({ accounts = [], categories = [], onSaved }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('expense');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => [firstBotMessage('expense')]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [goals, setGoals] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const bottomRef = useRef(null);

  const assetAccounts = useMemo(() => accounts.filter((a) => a.type === 'asset' && a.kind !== 'savings_goal'), [accounts]);
  const modeCategories = useMemo(() => categories.filter((c) => c.type === mode), [categories, mode]);
  const selectedAccount = assetAccounts.find((a) => a.id === accountId);
  const selectedGoal = goals.find((g) => g.id === goalId);

  useEffect(() => {
    if (!open) return;
    savingsGoals.list()
      .then((list) => setGoals((list || []).filter((g) => g.status === 'in_progress')))
      .catch(() => setGoals([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChatLoaded(false);
    setMessages([firstBotMessage(mode)]);
    quickEntry.getChatLog(mode)
      .then((data) => {
        if (cancelled) return;
        const storedMessages = Array.isArray(data?.messages) ? data.messages : [];
        setMessages(storedMessages.length > 0 ? storedMessages : [firstBotMessage(mode)]);
      })
      .catch(() => {
        if (!cancelled) setMessages([firstBotMessage(mode)]);
      })
      .finally(() => {
        if (!cancelled) setChatLoaded(true);
      });
    return () => { cancelled = true; };
  }, [open, mode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, parsing, saving]);

  useEffect(() => {
    if (!open || !chatLoaded) return;
    try {
      const safeMessages = messages
        .map(serializeMessage)
        .slice(-MAX_CHAT_LOG_MESSAGES);
      quickEntry.saveChatLog(mode, safeMessages).catch(() => {});
    } catch {}
  }, [messages, mode, open, chatLoaded]);

  const addMessage = (message) => {
    setMessages((prev) => [...prev, { id: messageId(), ...message }]);
  };

  const changeMode = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setInput('');
    setAccountId('');
    setGoalId('');
    setCategoryId('');
    setPendingText('');
    setParsed(null);
  };

  const clearChatLog = () => {
    setAccountId('');
    setGoalId('');
    setCategoryId('');
    setPendingText('');
    setParsed(null);
    setMessages([firstBotMessage(mode)]);
    quickEntry.clearChatLog(mode).catch(() => {});
  };

  const askAccount = (textToContinue, list = assetAccounts, context = {}) => {
    setPendingText(textToContinue);
    addMessage({
      role: 'bot',
      text: mode === 'saving' ? 'จะออมจากบัญชีไหนดี?' : 'จะบันทึกจากบัญชีไหนดี?',
      actions: list.map((account) => ({
        label: `${account.name} · ฿${fmt(account.balance)}`,
        onClick: () => selectAccount(account.id, textToContinue, context),
      })),
    });
  };

  const askAccountForPreview = (result) => {
    const list = mode === 'saving' && selectedGoal?.account_id
      ? assetAccounts.filter((a) => a.id !== selectedGoal.account_id)
      : assetAccounts;
    addMessage({
      role: 'bot',
      text: mode === 'saving' ? 'จะออมจากบัญชีไหนดี?' : 'จะบันทึกจากบัญชีไหนดี?',
      actions: list.map((account) => ({
        label: `${account.name} · ฿${fmt(account.balance)}`,
        onClick: () => {
          setAccountId(account.id);
          addMessage({ role: 'user', text: account.name });
          showPreview(result, categoryId, { accountId: account.id, goalId });
        },
      })),
    });
  };

  const askGoal = (textToContinue, context = {}) => {
    setPendingText(textToContinue);
    addMessage({
      role: 'bot',
      text: 'ออมเข้าเป้าหมายไหน?',
      actions: goals.map((goal) => ({
        label: goal.name,
        onClick: () => selectGoal(goal.id, textToContinue, context),
      })),
    });
  };

  const askCategory = (result) => {
    addMessage({
      role: 'bot',
      text: 'เลือกหมวดหมู่ให้รายการนี้หน่อย',
      actions: modeCategories.slice(0, 12).map((cat) => ({
        label: cat.name,
        onClick: () => {
          setCategoryId(cat.id);
          showPreview(result, cat.id);
        },
      })),
    });
  };

  const selectAccount = (id, textToContinue = pendingText, context = {}) => {
    setAccountId(id);
    const account = assetAccounts.find((a) => a.id === id);
    addMessage({ role: 'user', text: account?.name || 'เลือกบัญชีแล้ว' });
    const effectiveGoalId = context.goalId || goalId;
    if (mode === 'saving' && !effectiveGoalId) {
      askGoal(textToContinue, { accountId: id });
      return;
    }
    parseText(textToContinue, { accountId: id, goalId: effectiveGoalId });
  };

  const selectGoal = (id, textToContinue = pendingText, context = {}) => {
    setGoalId(id);
    const goal = goals.find((g) => g.id === id);
    addMessage({ role: 'user', text: goal?.name || 'เลือกเป้าหมายแล้ว' });
    const availableAccounts = assetAccounts.filter((a) => a.id !== goal?.account_id);
    const effectiveAccountId = context.accountId || accountId;
    if (!effectiveAccountId) {
      if (availableAccounts.length === 1) {
        setAccountId(availableAccounts[0].id);
        parseText(textToContinue, { goalId: id, accountId: availableAccounts[0].id });
      } else {
        askAccount(textToContinue, availableAccounts, { goalId: id });
      }
      return;
    }
    parseText(textToContinue, { goalId: id, accountId: effectiveAccountId });
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || parsing || saving || !chatLoaded) return;
    setInput('');
    addMessage({ role: 'user', text });

    if (mode !== 'saving' && assetAccounts.length === 0) {
      addMessage({ role: 'bot', text: 'ต้องสร้างบัญชีก่อน ถึงจะบันทึกรายรับหรือรายจ่ายได้' });
      return;
    }
    if (mode === 'saving' && goals.length === 0) {
      addMessage({ role: 'bot', text: 'ยังไม่มีเป้าหมายที่กำลังออม สร้างเป้าหมายก่อนแล้วค่อยกลับมาออมผ่านแชทได้' });
      return;
    }

    if (mode === 'saving' && !goalId) {
      askGoal(text);
      return;
    }
    if (!accountId) {
      const selectableAccounts = mode === 'saving' && selectedGoal?.account_id
        ? assetAccounts.filter((a) => a.id !== selectedGoal.account_id)
        : assetAccounts;
      if (selectableAccounts.length === 1) {
        selectAccount(selectableAccounts[0].id, text);
      } else {
        askAccount(text, selectableAccounts);
      }
      return;
    }

    parseText(text);
  };

  const parseText = async (text, overrides = {}) => {
    if (!text) return;
    setParsing(true);
    try {
      const result = await quickEntry.parse({ mode, text });
      setParsed(result);
      const nextCategoryId = result.category_id || '';
      setCategoryId(nextCategoryId);
      if (mode !== 'saving' && !nextCategoryId) {
        askCategory(result);
      } else {
        showPreview(result, nextCategoryId, overrides);
      }
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'แยกรายการไม่สำเร็จ ลองพิมพ์ใหม่อีกครั้ง' });
    } finally {
      setParsing(false);
      setPendingText('');
    }
  };

  const showPreview = (result, nextCategoryId = categoryId, overrides = {}) => {
    setParsed(result);
    setCategoryId(nextCategoryId || '');
    const previewAccountId = overrides.accountId || accountId;
    const previewGoalId = overrides.goalId || goalId;
    const previewAccount = assetAccounts.find((a) => a.id === previewAccountId);
    const previewGoal = goals.find((g) => g.id === previewGoalId);
    const previewCategory = categories.find((c) => c.id === nextCategoryId);

    addMessage({
      role: 'preview',
      result,
      account: previewAccount,
      goal: previewGoal,
      category: previewCategory,
      mode,
    });
  };

  const handleSave = async () => {
    if (!parsed || saving) return;
    const amount = Number(parsed.amount || 0);
    if (amount <= 0) {
      addMessage({ role: 'bot', text: 'จำนวนเงินต้องมากกว่า 0' });
      return;
    }

    setSaving(true);
    try {
      if (mode === 'saving') {
        const goal = selectedGoal;
        if (!goal) throw new Error('เลือกเป้าหมายการออมก่อน');
        if (!goal.account_id) throw new Error('เป้าหมายนี้ยังไม่ผูกบัญชีเก็บออม');
        if (!accountId) throw new Error('เลือกบัญชีต้นทางก่อน');
        if (accountId === goal.account_id) throw new Error('บัญชีต้นทางต้องไม่ใช่บัญชีเก็บออมของเป้าหมาย');
        if (selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await savingsGoals.deposit(goal.id, {
          from_account_id: accountId,
          amount,
          note: parsed.title || 'ออมเงิน',
          date: todayStr(),
        });
      } else {
        if (!accountId) throw new Error('เลือกบัญชีก่อน');
        if (!categoryId) throw new Error('เลือกหมวดหมู่ก่อน');
        if (mode === 'expense' && selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await transactions.create({
          type: mode,
          account_id: accountId,
          category_id: categoryId,
          amount,
          name: parsed.title || pendingText || 'บันทึกเร็ว',
          transaction_date: todayStr(),
        });
      }

      addMessage({
        role: 'bot',
        text: `บันทึก${MODE_META[mode].label}เรียบร้อยแล้ว`,
        success: true,
      });
      setParsed(null);
      setPendingText('');
      await onSaved?.();
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const renderMessage = (message) => {
    if (message.role === 'preview') {
      const meta = MODE_META[message.mode];
      return (
        <div key={message.id} className="flex justify-start">
          <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white border border-slate-100 shadow-sm p-3">
            <p className="text-xs text-slate-400 mb-1">ตรวจเจอ{meta.label}</p>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{message.result.title}</p>
                {message.mode !== 'saving' && (
                  <p className="text-xs text-slate-500 mt-1">หมวดหมู่: {message.category?.name || 'ยังไม่เลือก'}</p>
                )}
                {message.mode === 'saving' && (
                  <p className="text-xs text-slate-500 mt-1">เป้าหมาย: {message.goal?.name || '-'}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">บัญชี: {message.account?.name || '-'}</p>
              </div>
              <p className="text-lg font-bold whitespace-nowrap" style={{ color: meta.tone }}>฿{fmt(message.result.amount)}</p>
            </div>
            {!message.readonly && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-2 rounded-xl bg-[#2C6488] text-white text-xs font-semibold disabled:opacity-60"
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                {message.mode !== 'saving' && (
                  <button
                    onClick={() => askCategory(message.result)}
                    className="px-3 py-2 rounded-xl bg-slate-50 text-slate-600 text-xs font-semibold border border-slate-200"
                  >
                    เปลี่ยนหมวดหมู่
                  </button>
                )}
                <button
                  onClick={() => askAccountForPreview(message.result)}
                  className="px-3 py-2 rounded-xl bg-slate-50 text-slate-600 text-xs font-semibold border border-slate-200"
                >
                  เปลี่ยนบัญชี
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    const isUser = message.role === 'user';
    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-md bg-[#2C6488] text-white'
            : 'rounded-bl-md bg-white border border-slate-100 text-slate-700 shadow-sm'
        }`}>
          <div className="flex items-start gap-2">
            {!isUser && message.success && <CheckCircle2 size={15} color="#10b981" className="mt-0.5" />}
            <span>{message.text}</span>
          </div>
          {message.actions && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.actions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className="px-2.5 py-1.5 rounded-lg bg-[#EAF3F7] text-[#2C6488] text-xs font-semibold border border-[#DCE8EE]"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[850] w-12 h-12 rounded-2xl bg-[#2C6488] text-white shadow-lg shadow-[#2C6488]/20 flex items-center justify-center hover:opacity-90 transition-opacity"
          title="บันทึกเร็ว"
        >
          <MessageCircle size={21} color="white" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-[850] w-[min(420px,calc(100vw-32px))] h-[min(620px,calc(100vh-40px))] overflow-hidden rounded-2xl bg-[#F6FAFC] border border-slate-100 shadow-2xl shadow-slate-900/10 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#EAF3F7] flex items-center justify-center">
                <Sparkles size={16} color="#2C6488" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">ผู้ช่วยบันทึกเร็ว</p>
                <p className="text-xs text-slate-400">พิมพ์เหมือนคุย แล้วค่อยกดยืนยัน</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={clearChatLog}
                className="px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-500"
              >
                ล้าง
              </button>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center"
              >
                <X size={15} color="#64748b" />
              </button>
            </div>
          </div>

          <div className="px-4 pt-3 bg-white border-b border-slate-100">
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-50 p-1 mb-3">
              {Object.entries(MODE_META).map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => changeMode(key)}
                  className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                    mode === key ? 'bg-white shadow-sm' : 'text-slate-500'
                  }`}
                  style={{ color: mode === key ? meta.tone : undefined }}
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map(renderMessage)}
            {parsing && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-white border border-slate-100 px-3 py-2 text-sm text-slate-500 shadow-sm flex items-center gap-2">
                  <Bot size={15} color="#2C6488" />
                  กำลังตรวจรายการ...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-3 bg-white border-t border-slate-100">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                placeholder={MODE_META[mode].placeholder}
                disabled={!chatLoaded}
                className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C6488]/20 focus:border-[#2C6488]"
              />
              <button
                onClick={handleSend}
                disabled={parsing || saving || !chatLoaded}
                className="w-10 h-10 rounded-xl bg-[#2C6488] text-white flex items-center justify-center disabled:opacity-60"
              >
                {mode === 'saving' ? <PiggyBank size={17} color="white" /> : <Send size={17} color="white" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
