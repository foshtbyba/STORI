'use client';

import { useState } from 'react';

export default function SourcesPage() {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    buyerId: '', // ID баера
    label: '',
    token: '',
    cookiesJson: '',
    proxyUrl: '',
  });

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/fb-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert('FB-аккаунт успешно добавлен!');
      setForm({ buyerId: '', label: '', token: '', cookiesJson: '', proxyUrl: '' });
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Источники — Подключение FBtool</h1>

      {/* Форма добавления аккаунта */}
      <form onSubmit={handleAddAccount} className="bg-white p-6 rounded-xl shadow space-y-4 border border-gray-200">
        <h2 className="text-lg font-semibold">Добавить Facebook Аккаунт</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Название / Метка</label>
            <input
              type="text"
              placeholder="BM Ани №1"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="w-full border p-2 rounded"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Прокси (SOCKS5/HTTP)</label>
            <input
              type="text"
              placeholder="http://user:pass@ip:port"
              value={form.proxyUrl}
              onChange={(e) => setForm({ ...form, proxyUrl: e.target.value })}
              className="w-full border p-2 rounded"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Access Token (EAAB...)</label>
          <input
            type="text"
            placeholder="EAAB..."
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            className="w-full border p-2 rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Или Cookies (JSON)</label>
          <textarea
            rows={3}
            placeholder='[{"name": "c_user", "value": "..."}, ...]'
            value={form.cookiesJson}
            onChange={(e) => setForm({ ...form, cookiesJson: e.target.value })}
            className="w-full border p-2 rounded font-mono text-xs"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Привязка и парсинг...' : 'Добавить аккаунт'}
        </button>
      </form>
    </div>
  );
}