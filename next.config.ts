import type { NextConfig } from 'next';

const config: NextConfig = {
  // sharp — родная библиотека: собирать её в бандл нельзя, иначе на сервере
  // она молча не находится и превью отдаются в полном размере.
  serverExternalPackages: ['sharp'],
  experimental: {
    // Превью/фото и особенно ВИДЕО уезжают на сервер обычным экшеном одним
    // запросом. При заливе пачки роликов (напр. 5 штук + языки) 80mb легко
    // пробивается — Next рубит запрос ДО кода экшена, и клиент видит generic
    // «Server Components render error». Поднимаем лимит под видео-пачки.
    serverActions: { bodySizeLimit: '512mb' },
  },
};

export default config;
