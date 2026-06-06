import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { 
  MessageCircle, Send, Sparkles, AlertCircle, CheckCircle2, 
  Repeat2, PiggyBank, RefreshCw, HelpCircle,
  Lightbulb, BarChart2, ArrowRight, Check, Edit3, 
  CreditCard, TrendingUp, AlertTriangle, Info, Calendar
} from 'lucide-react';
import { 
  quickEntry, savingsGoals, transactions, budgets as budgetsApi, 
  notifications as notiApi, aiSummary as aiSummaryApi 
} from '../services/api';
import { fmt } from '../constants/data';
import { getTransactionAccounts } from '../utils/accountFilters';

const todayStr = () => new Date().toISOString().slice(0, 10);
const messageId = () => crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const MODE_META = {
  expense: { label: 'รายจ่าย', tone: '#ef4444', bg: '#fff1f2', placeholder: 'เช่น กาแฟ 50 หรือ ข้าวกะเพรา 60' },
  income: { label: 'รายรับ', tone: '#10b981', bg: '#f0fdf4', placeholder: 'เช่น เงินเดือน 30000 หรือ ค่าขนม 500' },
  saving: { label: 'การออม', tone: '#2C6488', bg: '#EAF3F7', placeholder: 'เช่น ออม 500 หรือ หยอดกระปุก 100' },
  transfer: { label: 'การโอน', tone: '#2563eb', bg: '#eff6ff', placeholder: 'เช่น โอน 300' },
};

const firstBotMessage = (mode) => ({
  id: messageId(),
  role: 'bot',
  text: `ยินดีต้อนรับเข้าสู่ช่องทางผู้ช่วยส่วนตัวครับ พิมพ์รายการเพื่อจดบันทึก หรือส่งรูปภาพสลิป/ใบเสร็จเพื่อจำแนกสแกนได้เลยครับ`,
});

const closeChoiceMessages = (messages, targetId = null) =>
  messages.map((msg) => (
    msg.choiceActive && (!targetId || msg.id === targetId)
      ? { ...msg, choiceActive: false }
      : msg
  ));

// Component: Budget Impact progress bar overlay
function BudgetImpactBar({ categoryId, amount, budgets = [], categories = [] }) {
  if (!categoryId || amount <= 0) return null;
  const cat = categories.find((c) => c.id === categoryId);
  
  // Find active budget for this category
  const today = new Date().toISOString().slice(0, 10);
  const budget = budgets.find(
    (b) => b.category_id === categoryId && b.is_active && b.end_date >= today
  );

  if (!budget) {
    return (
      <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100 dark:bg-slate-800/40 dark:border-slate-700/40 text-[11px] text-slate-400 flex items-center gap-1.5">
        <Lightbulb size={13} className="text-yellow-500 flex-shrink-0" />
        <span>ยังไม่ได้ตั้งงบประมาณสำหรับหมวดหมู่ {cat?.name || 'นี้'}</span>
      </div>
    );
  }

  const spent = budget.spent || 0;
  const limit = budget.amount;
  const pctBefore = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
  const pctAfter = limit > 0 ? Math.min(100, Math.round(((spent + amount) / limit) * 100)) : 0;
  
  const spentWidth = `${Math.min(100, (spent / limit) * 100)}%`;
  const additionWidth = `${Math.min(100 - (spent / limit) * 100, (amount / limit) * 100)}%`;
  const isOver = (spent + amount) > limit;
  const overAmount = (spent + amount) - limit;

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200/60 dark:bg-slate-850 dark:border-slate-700/50 space-y-2">
      <div className="flex justify-between items-center text-xs">
        <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <BarChart2 size={13} className="text-[#2C6488] dark:text-[#4da2db] flex-shrink-0" />
          <span>ผลกระทบต่องบประมาณ: {cat?.name}</span>
        </span>
        <span className="text-[11px] text-slate-400 font-medium">
          วงเงิน ฿{fmt(limit)}
        </span>
      </div>

      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden flex">
        <div 
          className="h-full bg-[#2C6488] transition-all duration-300"
          style={{ width: spentWidth }}
        />
        <div 
          className="h-full bg-amber-400 animate-pulse transition-all duration-300"
          style={{ width: additionWidth }}
        />
      </div>

      <div className="flex justify-between items-center text-[11px]">
        <span className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 flex-wrap">
          ใช้ไปแล้ว ฿{fmt(spent)} ({pctBefore}%) {amount > 0 && (
            <>
              + ฿{fmt(amount)} <ArrowRight size={11} className="inline text-slate-400" /> ฿{fmt(spent + amount)} ({pctAfter}%)
            </>
          )}
        </span>
        {isOver && (
          <span className="text-red-500 font-semibold animate-pulse">
            เกินงบไป ฿{fmt(overAmount)}!
          </span>
        )}
      </div>
    </div>
  );
}

export default function AssistantView({ accounts = [], categories = [], onRefresh, onGoAccounts, onGoGoals }) {
  const [mode, setMode] = useState('expense');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => [firstBotMessage('expense')]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [goals, setGoals] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [notifications, setNotifications] = useState([]);
  
  // Custom transaction editing state inside preview cards
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [parsed, setParsed] = useState(null);
  
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const chatBottomRef = useRef(null);
  const scrollContainerRef = useRef(null);



  // AI Summary state
  const [aiLoading, setAiLoading] = useState(false);

  const assetAccounts = useMemo(() => getTransactionAccounts(accounts), [accounts]);
  const modeCategories = useMemo(() => categories.filter((c) => c.type === mode), [categories, mode]);
  const selectedAccount = assetAccounts.find((a) => a.id === accountId);
  const selectedToAccount = assetAccounts.find((a) => a.id === toAccountId);
  const selectedGoal = goals.find((g) => g.id === goalId);

  // Sync back chat log changes to database
  const saveChatLog = useCallback(async (msgs) => {
    if (!chatLoaded) return;
    try {
      const safe = msgs.slice(-80).map((msg) => {
        if (msg.role === 'preview') {
          return {
            id: msg.id,
            role: 'preview',
            readonly: !!msg.readonly,
            mode: msg.mode,
            result: {
              title: msg.result?.title || '',
              amount: Number(msg.result?.amount || 0),
              category_id: msg.result?.category_id || '',
            },
            account: msg.account ? { id: msg.account.id, name: msg.account.name } : null,
            toAccount: msg.toAccount ? { id: msg.toAccount.id, name: msg.toAccount.name } : null,
            goal: msg.goal ? { id: msg.goal.id, name: msg.goal.name } : null,
            category: msg.category ? { id: msg.category.id, name: msg.category.name } : null,
          };
        }
        if (msg.role === 'ai_summary') {
          return {
            id: msg.id,
            role: 'ai_summary',
            period: msg.period,
            summary: msg.summary,
          };
        }
        return {
          id: msg.id,
          role: msg.role,
          text: msg.text || '',
          success: !!msg.success,
        };
      });
      await quickEntry.saveChatLog('chat', safe);
    } catch {}
  }, [chatLoaded]);

  // Fetch helper lists
  const fetchAuxData = useCallback(async () => {
    try {
      const [goalsList, budgetsList, notiList] = await Promise.all([
        savingsGoals.list().catch(() => []),
        budgetsApi.list().catch(() => []),
        notiApi.list().catch(() => []),
      ]);
      setGoals((goalsList || []).filter((g) => g.status === 'in_progress'));
      setBudgets(budgetsList || []);
      setNotifications(notiList || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchAuxData();
  }, [fetchAuxData]);

  // Load chat log history (syncs with bottom-right floating chat) and merge initial notifications
  useEffect(() => {
    let cancelled = false;
    setChatLoaded(false);

    const initChat = async () => {
      try {
        const [chatData, notiList] = await Promise.all([
          quickEntry.getChatLog('chat').catch(() => null),
          notiApi.list().catch(() => [])
        ]);
        if (cancelled) return;
        
        const storedMessages = Array.isArray(chatData?.messages) ? chatData.messages : [];
        let merged = storedMessages.length > 0 ? [...storedMessages] : [firstBotMessage('chat')];
        
        if (Array.isArray(notiList)) {
          notiList.forEach((noti) => {
            const exists = merged.some((m) => m.id === noti.id || m.notification_id === noti.id);
            if (!exists) {
              merged.push({
                id: noti.id,
                notification_id: noti.id,
                role: 'notification',
                notification_type: noti.notification_type,
                title: noti.title,
                text: noti.message,
                created_at: noti.created_at,
                action_taken: noti.action_taken,
                originalNoti: noti,
              });
            }
          });
        }
        
        setMessages(merged);
        setChatLoaded(true);
        // Persist initial merged list
        await quickEntry.saveChatLog('chat', merged.slice(-80));
      } catch {
        if (!cancelled) {
          setMessages([firstBotMessage('chat')]);
          setChatLoaded(true);
        }
      }
    };

    initChat();
    return () => { cancelled = true; };
  }, []);

  // Append new notifications to chat log when they arrive dynamically
  useEffect(() => {
    if (!chatLoaded || notifications.length === 0) return;
    setMessages((prev) => {
      let updated = [...prev];
      let changed = false;
      notifications.forEach((noti) => {
        const exists = updated.some((m) => m.id === noti.id || m.notification_id === noti.id);
        if (!exists) {
          updated.push({
            id: noti.id,
            notification_id: noti.id,
            role: 'notification',
            notification_type: noti.notification_type,
            title: noti.title,
            text: noti.message,
            created_at: noti.created_at,
            action_taken: noti.action_taken,
            originalNoti: noti,
          });
          changed = true;
        }
      });
      if (changed) {
        saveChatLog(updated);
      }
      return updated;
    });
  }, [notifications, chatLoaded, saveChatLog]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, parsing, aiLoading]);



  const addMessage = (message) => {
    setMessages((prev) => {
      const next = [...prev, { id: messageId(), ...message }];
      saveChatLog(next);
      return next;
    });
  };

  const addChoiceMessage = (message) => {
    setMessages((prev) => {
      const next = [
        ...closeChoiceMessages(prev),
        { id: messageId(), role: 'bot', choiceActive: true, ...message },
      ];
      saveChatLog(next);
      return next;
    });
  };

  const closeActiveChoices = (targetId = null) => {
    setMessages((prev) => {
      const next = closeChoiceMessages(prev, targetId);
      saveChatLog(next);
      return next;
    });
  };

  const changeMode = (nextMode) => {
    if (nextMode === mode) return;
    closeActiveChoices();
    setMode(nextMode);
    setInput('');
    setAccountId('');
    setToAccountId('');
    setGoalId('');
    setCategoryId('');
    setPendingText('');
    setParsed(null);
  };

  const clearChatLog = () => {
    setAccountId('');
    setToAccountId('');
    setGoalId('');
    setCategoryId('');
    setPendingText('');
    setParsed(null);
    setMessages([firstBotMessage('chat')]);
    quickEntry.clearChatLog('chat').catch(() => {});
  };

  // Ask for confirmation inputs
  const askAccount = (textToContinue, list = assetAccounts, context = {}) => {
    setPendingText(textToContinue);
    addChoiceMessage({
      choiceType: 'account',
      text: mode === 'saving'
        ? 'เลือกบัญชีที่ต้องการถอนเงินออม:'
        : mode === 'transfer'
          ? 'เลือกบัญชีต้นทางที่จะโอนเงินออก:'
          : 'เลือกบัญชีที่จะใช้จ่าย/รับเงิน:',
      actions: list.map((account) => ({
        label: `${account.name} (฿${fmt(account.balance)})`,
        onClick: () => selectAccount(account.id, textToContinue, context),
      })),
    });
  };

  const askTransferDestination = (textToContinue, fromAccountId = accountId, context = {}) => {
    const fromAccount = assetAccounts.find((a) => a.id === fromAccountId);
    const destinationAccounts = assetAccounts.filter((a) => a.id !== fromAccountId);
    if (destinationAccounts.length === 0) {
      addMessage({ role: 'bot', text: 'ต้องมีอย่างน้อย 2 บัญชี ถึงจะบันทึกการโอนได้ครับ' });
      return;
    }
    setPendingText(textToContinue);
    addChoiceMessage({
      choiceType: 'to_account',
      text: `เลือกบัญชีปลายทางที่จะรับเงินจาก "${fromAccount?.name || 'บัญชีต้นทาง'}":`,
      actions: destinationAccounts.map((account) => ({
        label: `${account.name} (฿${fmt(account.balance)})`,
        onClick: () => selectTransferDestination(account.id, textToContinue, { ...context, accountId: fromAccountId }),
      })),
    });
  };

  const askAccountForPreview = (result) => {
    if (mode === 'transfer') {
      addChoiceMessage({
        choiceType: 'account',
        text: 'เลือกบัญชีต้นทางใหม่:',
        actions: assetAccounts.map((account) => ({
          label: `${account.name} (฿${fmt(account.balance)})`,
          onClick: () => {
            if (result.amount > account.balance) {
              addMessage({
                role: 'bot',
                text: `ยอดเงินในบัญชี "${account.name}" ไม่เพียงพอครับ (ยอดคงเหลือ ฿${fmt(account.balance)}) ไม่สามารถโอน ฿${fmt(result.amount)} ได้`
              });
              return false;
            }
            setAccountId(account.id);
            setToAccountId('');
            addMessage({ role: 'user', text: account.name });
            askTransferDestination(pendingText, account.id, { result });
            return true;
          },
        })),
      });
      return;
    }
    const list = mode === 'saving' && selectedGoal?.account_id
      ? assetAccounts.filter((a) => a.id !== selectedGoal.account_id)
      : assetAccounts;
    addChoiceMessage({
      choiceType: 'account',
      text: mode === 'saving' ? 'จะออมจากบัญชีไหนดีครับ?' : 'จะบันทึกเงินเข้า/ออกจากบัญชีไหนดี?',
      actions: list.map((account) => ({
        label: `${account.name} (฿${fmt(account.balance)})`,
        onClick: () => {
          if ((mode === 'expense' || mode === 'saving') && result.amount > account.balance) {
            addMessage({
              role: 'bot',
              text: `ยอดเงินในบัญชี "${account.name}" ไม่เพียงพอครับ (ยอดคงเหลือ ฿${fmt(account.balance)}) ไม่สามารถเลือกบัญชีนี้สำหรับยอดเงิน ฿${fmt(result.amount)} ได้ กรุณาเลือกบัญชีอื่นหรือพิมพ์รายการใหม่ครับ`
            });
            return false;
          }
          setAccountId(account.id);
          addMessage({ role: 'user', text: account.name });
          showPreview(result, categoryId, { accountId: account.id, goalId });
          return true;
        },
      })),
    });
  };

  const askGoal = (textToContinue, context = {}) => {
    setPendingText(textToContinue);
    addChoiceMessage({
      choiceType: 'goal',
      text: 'เลือกเป้าหมายการออมที่ต้องการเก็บเงินเข้า:',
      actions: goals.map((goal) => ({
        label: goal.name,
        onClick: () => selectGoal(goal.id, textToContinue, context),
      })),
    });
  };

  const askCategory = (result) => {
    addChoiceMessage({
      choiceType: 'category',
      text: 'กรุณาเลือกหมวดหมู่ให้รายการนี้ด้วยครับ:',
      actions: modeCategories.map((cat) => ({
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
    if (mode === 'transfer') {
      setToAccountId('');
      askTransferDestination(textToContinue, id, context);
      return;
    }
    const effectiveGoalId = context.goalId || goalId;
    if (mode === 'saving' && !effectiveGoalId) {
      askGoal(textToContinue, { accountId: id });
      return;
    }
    parseText(textToContinue, { accountId: id, goalId: effectiveGoalId });
  };

  const selectTransferDestination = (id, textToContinue = pendingText, context = {}) => {
    const fromAccountId = context.accountId || accountId;
    if (!fromAccountId) {
      askAccount(textToContinue);
      return;
    }
    if (id === fromAccountId) {
      addMessage({ role: 'bot', text: 'บัญชีต้นทางและบัญชีปลายทางต้องไม่ใช่บัญชีเดียวกันครับ' });
      askTransferDestination(textToContinue, fromAccountId, context);
      return;
    }
    setToAccountId(id);
    const account = assetAccounts.find((a) => a.id === id);
    addMessage({ role: 'user', text: account?.name || 'เลือกบัญชีปลายทางแล้ว' });
    if (context.result) {
      showPreview(context.result, categoryId, { accountId: fromAccountId, toAccountId: id });
      return;
    }
    parseText(textToContinue, { accountId: fromAccountId, toAccountId: id });
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
    closeActiveChoices();

    // Handle slash or text commands for summaries
    if (text === 'สรุปรายสัปดาห์' || text === 'สรุปการเงินรายสัปดาห์') {
      handleGenerateSummaryInline('weekly');
      return;
    }
    if (text === 'สรุปรายเดือน' || text === 'สรุปการเงินรายเดือน') {
      handleGenerateSummaryInline('monthly');
      return;
    }
    if (text === 'วิธีจดบันทึก' || text === 'คู่มือ') {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      addMessage({ role: 'user', text });
      addMessage({ role: 'bot', text: 'เลื่อนขึ้นไปที่ด้านบนสุดของห้องแชทเพื่อดูคู่มือและวิธีกรอกข้อมูลได้เลยครับ' });
      return;
    }

    addMessage({ role: 'user', text });

    if ((mode === 'income' || mode === 'expense') && assetAccounts.length === 0) {
      addMessage({
        role: 'bot',
        text: 'ต้องสร้างบัญชีก่อน ถึงจะบันทึกรายรับหรือรายจ่ายได้ครับ',
        actions: onGoAccounts ? [
          {
            label: 'ไปที่หน้าจัดการบัญชี',
            onClick: onGoAccounts
          }
        ] : undefined
      });
      return;
    }
    if (mode === 'transfer' && assetAccounts.length < 2) {
      addMessage({
        role: 'bot',
        text: assetAccounts.length === 0
          ? 'ต้องสร้างบัญชีก่อน ถึงจะบันทึกการโอนได้ครับ'
          : 'ต้องมีอย่างน้อย 2 บัญชี ถึงจะบันทึกการโอนได้ครับ',
        actions: onGoAccounts ? [
          {
            label: 'ไปที่หน้าจัดการบัญชี',
            onClick: onGoAccounts
          }
        ] : undefined
      });
      return;
    }
    if (mode === 'saving' && goals.length === 0) {
      addMessage({
        role: 'bot',
        text: 'ยังไม่มีเป้าหมายการออมเงินในตอนนี้ สร้างเป้าหมายก่อนนะครับ',
        actions: onGoGoals ? [
          {
            label: 'ไปที่หน้าตั้งเป้าหมายออมเงิน',
            onClick: onGoGoals
          }
        ] : undefined
      });
      return;
    }

    if (mode === 'saving' && !goalId) {
      askGoal(text);
      return;
    }
    if (mode === 'transfer' && !accountId) {
      askAccount(text);
      return;
    }
    if (mode === 'transfer' && !toAccountId) {
      askTransferDestination(text, accountId);
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
      
      const activeAccId = overrides.accountId || accountId;
      const activeToAccId = overrides.toAccountId || toAccountId;
      const activeAcc = assetAccounts.find((a) => a.id === activeAccId);
      if (activeAcc && (mode === 'expense' || mode === 'saving' || mode === 'transfer') && result.amount > activeAcc.balance) {
        addMessage({
          role: 'bot',
          text: `ยอดเงินในบัญชี "${activeAcc.name}" ไม่เพียงพอครับ (ยอดคงเหลือ ฿${fmt(activeAcc.balance)}) แต่คุณระบุจำนวนเงิน ฿${fmt(result.amount)} กรุณากรอกจำนวนเงินใหม่ให้ถูกต้อง`
        });
        setParsed(null);
        setPendingText('');
        return;
      }
      if (mode === 'transfer') {
        if (!activeAccId) {
          askAccount(text);
          return;
        }
        if (!activeToAccId) {
          askTransferDestination(text, activeAccId);
          return;
        }
        if (activeAccId === activeToAccId) {
          addMessage({ role: 'bot', text: 'บัญชีต้นทางและบัญชีปลายทางต้องไม่ใช่บัญชีเดียวกันครับ' });
          askTransferDestination(text, activeAccId);
          return;
        }
      }

      setParsed(result);
      const nextCategoryId = result.category_id || '';
      setCategoryId(nextCategoryId);
      if (mode !== 'saving' && mode !== 'transfer' && !nextCategoryId) {
        askCategory(result);
      } else {
        showPreview(result, nextCategoryId, overrides);
      }
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'แยกรายการไม่สำเร็จ ลองพิมพ์ใหม่อีกครั้งนะครับ' });
    } finally {
      setParsing(false);
      setPendingText('');
    }
  };

  const showPreview = (result, nextCategoryId = categoryId, overrides = {}) => {
    setParsed(result);
    setCategoryId(nextCategoryId || '');
    const previewAccountId = overrides.accountId || accountId;
    const previewToAccountId = overrides.toAccountId || toAccountId;
    const previewGoalId = overrides.goalId || goalId;
    const previewAccount = assetAccounts.find((a) => a.id === previewAccountId);
    const previewToAccount = assetAccounts.find((a) => a.id === previewToAccountId);
    const previewGoal = goals.find((g) => g.id === previewGoalId);
    const previewCategory = categories.find((c) => c.id === nextCategoryId);

    addMessage({
      role: 'preview',
      result,
      account: previewAccount,
      toAccount: previewToAccount,
      goal: previewGoal,
      category: previewCategory,
      mode,
    });
  };

  const handleCancelPreview = (msgId, title, amount) => {
    setMessages((prev) => {
      const filtered = closeChoiceMessages(prev).filter((m) => m.id !== msgId);
      const next = [
        ...filtered,
        {
          id: messageId(),
          role: 'bot',
          text: `ยกเลิกการบันทึกรายการ "${title}" จำนวน ฿${fmt(amount)} เรียบร้อยแล้วครับ`,
        }
      ];
      saveChatLog(next);
      return next;
    });
    setParsed(null);
    setPendingText('');
  };

  const handleSave = async () => {
    if (!parsed || saving) return;
    const amount = Number(parsed.amount || 0);
    if (amount <= 0) {
      addMessage({ role: 'bot', text: 'จำนวนเงินต้องมากกว่า 0 บาทครับ' });
      return;
    }

    setSaving(true);
    try {
      if (mode === 'saving') {
        const goal = selectedGoal;
        if (!goal) throw new Error('กรุณาเลือกเป้าหมายการออมก่อน');
        if (!goal.account_id) throw new Error('เป้าหมายนี้ยังไม่ได้สร้างบัญชีเป้าหมายเพื่อเก็บออม');
        if (!accountId) throw new Error('กรุณาเลือกบัญชีที่จะโอนเงินออก');
        if (accountId === goal.account_id) throw new Error('บัญชีต้นทางต้องไม่ใช่บัญชีเป้าหมายเดียวกัน');
        if (selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await savingsGoals.deposit(goal.id, {
          from_account_id: accountId,
          amount,
          note: parsed.title || 'ออมเงินผ่านแชทผู้ช่วย',
          date: todayStr(),
        });
      } else if (mode === 'transfer') {
        if (!accountId) throw new Error('กรุณาเลือกบัญชีต้นทาง');
        if (!toAccountId) throw new Error('กรุณาเลือกบัญชีปลายทาง');
        if (accountId === toAccountId) throw new Error('บัญชีต้นทางและบัญชีปลายทางต้องไม่ใช่บัญชีเดียวกัน');
        if (!selectedToAccount) throw new Error('ไม่พบบัญชีปลายทางที่เลือก');
        if (selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีต้นทางไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await transactions.create({
          type: 'transfer',
          account_id: accountId,
          to_account_id: toAccountId,
          amount,
          name: parsed.title || pendingText || 'โอนเงินผ่านผู้ช่วย',
          transaction_date: todayStr(),
        });
      } else {
        if (!accountId) throw new Error('กรุณาเลือกบัญชี');
        if (!categoryId) throw new Error('กรุณาเลือกหมวดหมู่');
        if (mode === 'expense' && selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await transactions.create({
          type: mode,
          account_id: accountId,
          category_id: categoryId,
          amount,
          name: parsed.title || pendingText || 'บันทึกผ่านผู้ช่วย',
          transaction_date: todayStr(),
        });
      }

      setMessages((prev) => {
        const updated = closeChoiceMessages(prev).map((m) => {
          if (m.role === 'preview' && !m.readonly) {
            return { ...m, readonly: true };
          }
          return m;
        });
        const next = [
          ...updated,
          {
            id: messageId(),
            role: 'bot',
            text: `บันทึก${MODE_META[mode].label} ฿${fmt(amount)} เรียบร้อยแล้วครับ!`,
            success: true,
          }
        ];
        saveChatLog(next);
        return next;
      });
      setParsed(null);
      setPendingText('');
      setToAccountId('');
      
      // Refresh views
      await onRefresh?.();
      await fetchAuxData();
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'บันทึกรายการไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  // AI Summary Handler Inline
  const handleGenerateSummaryInline = async (period) => {
    const periodLabel = period === 'weekly' ? 'สัปดาห์' : 'เดือน';
    
    // Add user query
    const userMsgId = messageId();
    const nextMsgs1 = [
      ...messages,
      { id: userMsgId, role: 'user', text: `กรุณาสรุปการเงินราย${periodLabel}ให้หน่อยครับ` }
    ];
    setMessages(nextMsgs1);
    saveChatLog(nextMsgs1);

    // Add bot loading status
    const botLoadingId = messageId();
    const nextMsgs2 = [
      ...nextMsgs1,
      { id: botLoadingId, role: 'bot', text: `กำลังรวบรวมและวิเคราะห์ข้อมูลการเงินราย${periodLabel}ด้วย AI สักครู่ครับ...` }
    ];
    setMessages(nextMsgs2);
    setAiLoading(true);

    try {
      await aiSummaryApi.generate(period);
      const detail = await aiSummaryApi.get(period);
      
      setAiLoading(false);
      if (detail && detail.summary) {
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== botLoadingId);
          const next = [
            ...filtered,
            {
              id: messageId(),
              role: 'ai_summary',
              period,
              summary: detail.summary
            }
          ];
          saveChatLog(next);
          return next;
        });
      } else {
        throw new Error('ไม่พบข้อมูลสรุป');
      }
    } catch (err) {
      setAiLoading(false);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== botLoadingId);
        const next = [
          ...filtered,
          {
            id: messageId(),
            role: 'bot',
            text: `ไม่สามารถดึงข้อมูลสรุปได้ในขณะนี้: ${err.message || 'ข้อมูลธุรกรรมไม่เพียงพอ (ต้องการรายการรายรับ/รายจ่ายเพื่อสรุป)'}`
          }
        ];
        saveChatLog(next);
        return next;
      });
    }
  };

  // Notifications Interactive Inline Trigger
  const handleConfirmNotification = async (noti, notiMsgId) => {
    try {
      await notiApi.confirm(noti.id);
      setMessages((prev) => {
        const next = prev.map((m) => 
          m.id === notiMsgId || m.notification_id === noti.id 
            ? { ...m, action_taken: true } 
            : m
        );
        saveChatLog(next);
        return next;
      });
      await fetchAuxData();
      await onRefresh?.();
    } catch (err) {
      alert(err.message || 'ไม่สามารถยืนยันรายการทำซ้ำได้');
    }
  };

  const handleSkipNotification = async (noti, notiMsgId) => {
    try {
      await notiApi.skip(noti.id);
      setMessages((prev) => {
        const next = prev.map((m) => 
          m.id === notiMsgId || m.notification_id === noti.id 
            ? { ...m, action_taken: true } 
            : m
        );
        saveChatLog(next);
        return next;
      });
      await fetchAuxData();
    } catch (err) {
      alert(err.message || 'ไม่สามารถข้ามรายการได้');
    }
  };

  const handleGuideScroll = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Render chatbot messages
  const renderMsg = (message) => {
    if (message.role === 'preview') {
      const meta = MODE_META[message.mode];
      return (
        <div key={message.id} className="flex justify-start animate-fade-in">
          <div className="max-w-[90%] md:max-w-[75%] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-md p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-700/50 pb-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: meta.tone, background: meta.bg }}>
                {meta.label}
              </span>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Info size={11} />
                <span>ตรวจสอบข้อมูลธุรกรรม</span>
              </span>
            </div>
            
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{message.result.title}</p>
                {(message.mode === 'income' || message.mode === 'expense') && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    หมวดหมู่: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.category?.name || 'ไม่ได้เลือก'}</span>
                  </p>
                )}
                {message.mode === 'saving' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    เป้าหมายการออม: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.goal?.name || '-'}</span>
                  </p>
                )}
                {message.mode === 'transfer' ? (
                  <>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      จากบัญชี: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.account?.name || '-'}</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      ไปบัญชี: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.toAccount?.name || '-'}</span>
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    กระเป๋าเงินบัญชี: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.account?.name || '-'}</span>
                  </p>
                )}
              </div>
              <p className="text-xl font-bold whitespace-nowrap" style={{ color: meta.tone }}>
                ฿{fmt(message.result.amount)}
              </p>
            </div>

            {message.mode === 'expense' && (
              <BudgetImpactBar 
                categoryId={message.category?.id} 
                amount={Number(message.result.amount || 0)} 
                budgets={budgets}
                categories={categories}
              />
            )}

            {!message.readonly && (
              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3.5 py-2 rounded-xl bg-[#2C6488] hover:bg-[#25536F] text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
                >
                  <span className="flex items-center gap-1.5">
                    <Check size={13} />
                    <span>{saving ? 'กำลังบันทึก...' : 'บันทึกธุรกรรม'}</span>
                  </span>
                </button>
                {(message.mode === 'income' || message.mode === 'expense') && (
                  <button
                    onClick={() => askCategory(message.result)}
                    className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-650 text-slate-600 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-600 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Edit3 size={13} />
                      <span>เปลี่ยนหมวด</span>
                    </span>
                  </button>
                )}
                <button
                  onClick={() => askAccountForPreview(message.result)}
                  className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-650 text-slate-600 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-600 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={13} />
                    <span>{message.mode === 'transfer' ? 'เปลี่ยนบัญชีโอน' : 'เปลี่ยนบัญชี'}</span>
                  </span>
                </button>
                <button
                  onClick={() => handleCancelPreview(message.id, message.result.title, message.result.amount)}
                  className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-900/30 text-red-650 dark:text-red-400 text-xs font-semibold border border-red-100 dark:border-red-900/40 transition-colors"
                >
                  <span>ยกเลิก</span>
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (message.role === 'notification') {
      let badgeBg = 'bg-slate-50 text-slate-500';
      let iconElement = <HelpCircle size={13} />;
      let label = 'การแจ้งเตือน';

      if (message.notification_type === 'recurring') {
        badgeBg = 'bg-blue-50 dark:bg-slate-700/50 text-[#2C6488] dark:text-[#4da2db]';
        iconElement = <Repeat2 size={13} />;
        label = 'รายการประจำ';
      } else if (message.notification_type === 'budget_over') {
        badgeBg = 'bg-red-50 dark:bg-red-950/45 text-red-500';
        iconElement = <AlertCircle size={13} />;
        label = 'งบประมาณเกิน';
      } else if (message.notification_type === 'budget_near_limit') {
        badgeBg = 'bg-amber-50 dark:bg-amber-950/40 text-amber-500';
        iconElement = <AlertCircle size={13} />;
        label = 'งบประมาณใกล้เต็ม';
      } else if (message.notification_type === 'goal_due') {
        badgeBg = 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600';
        iconElement = <PiggyBank size={13} />;
        label = 'เป้าหมายการออม';
      }

      return (
        <div key={message.id} className="flex justify-start animate-fade-in">
          <div className="max-w-[90%] md:max-w-[75%] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-md p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-700/50 pb-2">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeBg}`}>
                {iconElement}
                <span>{label}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {message.created_at ? new Date(message.created_at).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' }) : 'วันนี้'}
              </span>
            </div>

            <div className="space-y-1">
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">{message.title}</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">{message.text}</p>
            </div>

            {message.notification_type === 'recurring' && (
              <div className="pt-1 flex gap-2">
                {message.action_taken ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500 font-semibold bg-emerald-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-emerald-100 dark:border-slate-700">
                    <Check size={13} />
                    <span>บันทึกสำเร็จเรียบร้อย</span>
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => handleConfirmNotification(message.originalNoti, message.id)}
                      className="px-3 py-1.5 rounded-xl bg-[#2C6488] hover:bg-[#25536F] text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        <Check size={12} />
                        <span>บันทึกรายการ</span>
                      </span>
                    </button>
                    <button
                      onClick={() => handleSkipNotification(message.originalNoti, message.id)}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-650 text-slate-650 dark:text-slate-350 text-xs font-semibold transition-colors"
                    >
                      <span>ข้ามรอบนี้</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (message.role === 'ai_summary') {
      const summary = message.summary || {};
      const isWeekly = message.period === 'weekly';
      return (
        <div key={message.id} className="flex justify-start animate-fade-in w-full">
          <div className="w-full max-w-[95%] md:max-w-[85%] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-700/50 pb-2.5">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-yellow-50 dark:bg-slate-750 text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                <Sparkles size={12} className="text-yellow-500" />
                <span>วิเคราะห์การเงินราย{isWeekly ? 'สัปดาห์' : 'เดือน'}ด้วย AI</span>
              </span>
              <span className="text-xs text-slate-400">สรุปรายงานบัญชี</span>
            </div>

            <div>
              <h4 className="text-sm font-bold text-[#2C6488] dark:text-[#4da2db]">{summary.title || 'วิเคราะห์สถิติภาพรวม'}</h4>
              <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed mt-1.5">{summary.overview}</p>
            </div>

            {summary.highlights?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-450 flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-emerald-500 flex-shrink-0" />
                  <span>จุดเด่นทางการเงิน</span>
                </p>
                <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  {summary.highlights.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.cautions?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
                  <span>ข้อพึงระวังด้านบัญชี</span>
                </p>
                <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  {summary.cautions.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.suggestions?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-[#2C6488] dark:text-[#4da2db] flex items-center gap-1.5">
                  <Info size={13} className="text-[#2C6488] dark:text-[#4da2db] flex-shrink-0" />
                  <span>แนวทางคำแนะนำแก้ไข</span>
                </p>
                <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  {summary.suggestions.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      );
    }

    const isUser = message.role === 'user';
    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}>
        <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-none bg-[#2C6488] text-white shadow-sm'
            : 'rounded-bl-none bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 text-slate-700 dark:text-slate-350 shadow-sm'
        }`}>
          <div className="flex items-start gap-2">
            {!isUser && (
              <div className="w-5 h-5 rounded-lg bg-[#EAF3F7] dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <MessageCircle size={13} className="text-[#2C6488] dark:text-[#4da2db]" />
              </div>
            )}
            <div className="flex-1">
              <span className="whitespace-pre-wrap">{message.text}</span>
            </div>
            {!isUser && message.success && (
              <CheckCircle2 size={16} color="#10b981" className="mt-0.5 flex-shrink-0" />
            )}
          </div>
          {message.actions && message.choiceActive !== false && (
            <div className="mt-3 flex flex-wrap gap-1.5 pl-7">
              {message.actions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => {
                    const shouldClose = action.onClick?.();
                    if (shouldClose !== false) closeActiveChoices(message.id);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#EAF3F7] hover:bg-[#DCE8EE] dark:bg-slate-700/80 dark:hover:bg-slate-650 text-[#2C6488] dark:text-[#4da2db] text-xs font-bold border border-[#DCE8EE]/50 dark:border-slate-600 transition-colors"
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => closeActiveChoices(message.id)}
                className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-700/80 dark:hover:bg-slate-650 text-slate-500 dark:text-slate-300 text-xs font-bold border border-slate-200 dark:border-slate-600 transition-colors"
              >
                ปิด
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 w-full max-w-5xl mx-auto flex-1 flex flex-col min-h-0 relative">
      {/* Main Single Chat Card Container */}
      <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm h-full">
        
        {/* Header */}
        <div className="bg-white dark:bg-slate-800 px-5 py-4 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF3F7] dark:bg-slate-700 flex items-center justify-center">
              <MessageCircle size={20} className="text-[#2C6488] dark:text-[#4da2db]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">แชท PaoJot</h3>
              <p className="text-[11px] text-slate-400">ผู้ช่วยจัดการการเงิน วิเคราะห์ OCR และคำนวณงบประมาณในช่องแชทเดียว</p>
            </div>
          </div>
          <button 
            onClick={clearChatLog}
            className="text-xs font-semibold text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            ล้างประวัติแชท
          </button>
        </div>



        {/* Scrollable Chat Area */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-5 space-y-4"
        >
          {/* Welcome User Guide Card */}
          <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 rounded-2xl p-5 mb-4 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50 pb-2.5">
              <MessageCircle className="text-[#2C6488] dark:text-[#4da2db]" size={18} />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">คู่มือและวิธีการกรอกข้อมูลในช่องแชท</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
              <div className="space-y-1.5">
                <h4 className="font-bold text-[#2C6488] dark:text-[#4da2db] flex items-center gap-1.5">
                  <Edit3 size={13} />
                  <span>1. วิธีการจดบันทึกรายวัน</span>
                </h4>
                <ul className="list-disc list-inside text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  <li><strong>รายจ่าย</strong>: พิมพ์ "ข้าวแกง 50"</li>
                  <li><strong>รายรับ</strong>: พิมพ์ "เงินเดือน 30000"</li>
                  <li><strong>การออม</strong>: พิมพ์ "ออม 500"</li>
                  <li><strong>การโอน</strong>: พิมพ์ "โอน 300"</li>
                </ul>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-bold text-[#2C6488] dark:text-[#4da2db] flex items-center gap-1.5">
                  <Sparkles size={13} className="text-yellow-500" />
                  <span>2. ระบบแจ้งเตือน & AI</span>
                </h4>
                <p className="text-slate-500 dark:text-slate-400 leading-normal pl-1">
                  สัญญาณเตือนเกี่ยวกับงบประมาณ งวดโอนเงินประจำ หรือรายงานการวิเคราะห์รายสัปดาห์/เดือน จะถูกส่งเข้ามาตอบโต้ในหน้านี้โดยตรง
                </p>
              </div>
            </div>
          </div>

          {messages.map(renderMsg)}
          
          {parsing && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-none bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 px-4 py-2.5 text-sm text-slate-500 shadow-sm flex items-center gap-2 animate-fade-in">
                <RefreshCw size={14} className="animate-spin text-[#2C6488]" />
                กำลังตีความรายละเอียดธุรกรรม...
              </div>
            </div>
          )}
          


          {aiLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-none bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 px-4 py-2.5 text-sm text-slate-500 shadow-sm flex items-center gap-2 animate-fade-in">
                <RefreshCw size={14} className="animate-spin text-[#2C6488]" />
                AI กำลังประมวลผลข้อมูลบทวิเคราะห์ภาพรวมการเงิน...
              </div>
            </div>
          )}



          <div ref={chatBottomRef} />
        </div>

        {/* Quick Action Chips Bar */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 flex-shrink-0">
          <button 
            onClick={() => changeMode('expense')}
            className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'expense'
                ? 'bg-[#2C6488] border-[#2C6488] text-white font-extrabold hover:bg-[#25536F]'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${mode === 'expense' ? 'bg-red-200' : 'bg-red-400'}`} />
            <span>จดรายจ่าย</span>
          </button>

          <button 
            onClick={() => changeMode('income')}
            className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'income'
                ? 'bg-[#2C6488] border-[#2C6488] text-white font-extrabold hover:bg-[#25536F]'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${mode === 'income' ? 'bg-emerald-200' : 'bg-emerald-400'}`} />
            <span>จดรายรับ</span>
          </button>

          <button 
            onClick={() => changeMode('saving')}
            className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'saving'
                ? 'bg-[#2C6488] border-[#2C6488] text-white font-extrabold hover:bg-[#25536F]'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${mode === 'saving' ? 'bg-[#BFD8E4]' : 'bg-[#2C6488]'}`} />
            <span>บันทึกการออม</span>
          </button>

          <button
            onClick={() => changeMode('transfer')}
            className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'transfer'
                ? 'bg-[#2C6488] border-[#2C6488] text-white font-extrabold hover:bg-[#25536F]'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${mode === 'transfer' ? 'bg-blue-200' : 'bg-blue-500'}`} />
            <span>บันทึกการโอน</span>
          </button>

          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 self-center" />

          <button 
            onClick={() => handleGenerateSummaryInline('weekly')}
            disabled={aiLoading}
            className="px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-xs font-bold text-[#2C6488] dark:text-[#4da2db] hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-60"
          >
            <Sparkles size={13} className="text-yellow-500" />
            <span>สร้างสรุปรายสัปดาห์</span>
          </button>
          
          <button 
            onClick={() => handleGenerateSummaryInline('monthly')}
            disabled={aiLoading}
            className="px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-xs font-bold text-[#2C6488] dark:text-[#4da2db] hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-60"
          >
            <Calendar size={13} className="text-blue-500" />
            <span>สร้างสรุปรายเดือน</span>
          </button>

          <button 
            onClick={handleGuideScroll}
            className="px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-xs font-bold text-slate-500 dark:text-slate-455 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <HelpCircle size={13} />
            <span>ดูคู่มือใช้งาน</span>
          </button>
        </div>

        {/* Chat Text Input Bar & Upload triggers */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
          <div className="max-w-4xl mx-auto flex items-center gap-2 bg-white dark:bg-slate-800 p-2.5 rounded-2xl shadow-md border border-slate-150 dark:border-slate-700/60 focus-within:ring-2 focus-within:ring-[#2C6488]/30 transition-all">

            {/* Active Mode Indicator Badge */}
            <span 
              className="text-xs font-extrabold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all select-none flex-shrink-0"
              style={{ 
                color: MODE_META[mode].tone, 
                backgroundColor: mode === 'saving' ? '#EAF3F7' : MODE_META[mode].bg
              }}
            >
              <span>{MODE_META[mode].label}</span>
            </span>

            {/* Main Input Text Field */}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder={MODE_META[mode].placeholder}
              disabled={!chatLoaded || parsing || aiLoading}
              className="flex-1 min-w-0 px-2 py-2 text-sm bg-transparent text-slate-700 dark:text-slate-300 focus:outline-none"
            />
            
            {/* Send Button */}
            <button
              onClick={handleSend}
              disabled={parsing || saving || aiLoading || !chatLoaded}
              className="w-10 h-10 rounded-xl bg-[#2C6488] hover:bg-[#25536F] text-white flex items-center justify-center transition-colors disabled:opacity-60 flex-shrink-0"
            >
              <Send size={16} />
            </button>

          </div>
        </div>

      </div>
    </div>
  );
}
