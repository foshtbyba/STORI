'use client';

import { useState } from 'react';
import { Panel, Badge } from './ui';
import { IconTag } from './icons';
import TemplateManager, { type Template } from './TemplateManager';
import LanguagePack, { type Language } from './LanguagePack';

/**
 * Настройки автозалива одной панелью с вкладками сверху (как метод-переключатель):
 * «Шаблоны гео» первой, «Языки для видео» второй. У каждого свои, личные.
 */
export default function UploadSettings({ templates, languages }: { templates: Template[]; languages: Language[] }) {
  const [tab, setTab] = useState<'templates' | 'languages'>('templates');
  const [q, setQ] = useState('');
  const pill = (on: boolean) =>
    `rounded-full border px-4 py-1.5 text-[12px] transition ${on ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-mute hover:border-sage'}`;

  return (
    <Panel className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge tint="bg-amber-t"><IconTag color="#d2a06a" /></Badge>
        <span className="text-[17px] font-semibold tracking-[-0.015em]">Мои настройки залива</span>
      </div>

      {/* Вкладки как метод-переключатель: отдельным рядом под заголовком, слева.
          Поиск по шаблонам — справа в этом же ряду. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTab('templates')} className={pill(tab === 'templates')}>
          Шаблоны гео <span className="opacity-70">· {templates.length}</span>
        </button>
        <button type="button" onClick={() => setTab('languages')} className={pill(tab === 'languages')}>
          Языки для видео <span className="opacity-70">· {languages.length}</span>
        </button>
        {tab === 'templates' && templates.length > 0 ? (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию…"
            className="ml-auto h-9 w-[240px] rounded-full border border-line2 bg-sub px-4 text-[12.5px] text-soft outline-none focus:border-sage"
          />
        ) : null}
      </div>

      <div className="mt-4">
        {tab === 'templates' ? <TemplateManager templates={templates} query={q} /> : <LanguagePack languages={languages} />}
      </div>
    </Panel>
  );
}
