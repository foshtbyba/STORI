import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    // Превью и фото отзывов уезжают на сервер обычным экшеном. Дефолтный
    // лимит в мегабайт для картинок мал — поднимаем до разумного.
    serverActions: { bodySizeLimit: '12mb' },
  },
};

export default config;
