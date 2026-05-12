import { Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function SetupAccountPage({ onComplete }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">

        {/* Logo */}
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-6 shadow-xl">
          <Wallet size={38} color="white" />
        </div>

        {/* Welcome text */}
        <h1 className="text-3xl font-bold text-slate-800 mb-2">
          ยินดีต้อนรับ 🎉
        </h1>
        <p className="text-lg font-semibold text-blue-600 mb-2">{user?.username}</p>
        <p className="text-slate-500 text-sm leading-relaxed mb-8">
          บัญชี PaoJot ของคุณพร้อมใช้งานแล้ว<br />
          เริ่มจัดการการเงินส่วนตัวได้เลย
        </p>

        {/* Enter button */}
        <button
          onClick={onComplete}
          className="w-full btn-primary text-white py-3.5 rounded-2xl font-semibold text-base shadow-lg hover:shadow-xl transition-shadow"
        >
          เข้าสู่ PaoJot →
        </button>

        <button
          onClick={logout}
          className="mt-4 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          ออกจากระบบ
        </button>
      </div>
    </div>
  );
}
