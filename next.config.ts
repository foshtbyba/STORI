import type { NextConfig } from 'next';

const config: NextConfig = {
  // sharp — родная библиотека: собирать её в бандл нельзя, иначе на сервере
  // она молча не находится и превью отдаются в полном размере.
  serverExternalPackages: ['sharp'],
  experimental: {
    // Превью и фото отзывов уезжают на сервер обычным экшеном. Дефолтный
    // лимит в мегабайт для картинок мал — поднимаем до разумного.
    serverActions: { bodySizeLimit: '80mb' },
  },
};

export default config;
