import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { extractTokenFromCookies, makeFbRequest, toggleFbCampaign } from '@/lib/fb-engine';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { buyerId, label, token: rawToken, cookiesJson, proxyUrl } = body;

    let finalToken = rawToken;

    // Если токен не передан, вытаскиваем его из Cookies
    if (!finalToken && cookiesJson) {
      finalToken = await extractTokenFromCookies(cookiesJson, proxyUrl);
    }

    if (!finalToken) {
      return NextResponse.json({ error: 'Необходимо указать токен EAAB или валидные Cookies' }, { status: 400 });
    }

    // Сохраняем аккаунт в БД
    const adToken = await prisma.adToken.create({
      data: {
        buyerId,
        label: label || 'FB Account',
        token: finalToken,
        cookiesJson,
        proxyUrl,
        status: 'ACTIVE',
      },
    });

    // Загружаем привязанные рекламные кабинеты (act_)
    const accountsData = await makeFbRequest('https://graph.facebook.com/v19.0/me/adaccounts', {
      access_token: finalToken,
      fields: 'account_id,name,currency,account_status',
    }, proxyUrl);

    if (accountsData.data) {
      for (const acc of accountsData.data) {
        await prisma.adAccount.create({
          data: {
            tokenId: adToken.id,
            externalId: `act_${acc.account_id}`,
            name: acc.name,
            currency: acc.currency,
            accountStatus: acc.account_status,
          },
        });
      }
    }

    return NextResponse.json({ success: true, adToken });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Изменение статуса кампании (Запуск / Пауза)
export async function PATCH(req: Request) {
  try {
    const { campaignId, status, tokenId } = await req.json();

    const adToken = await prisma.adToken.findUnique({ where: { id: tokenId } });
    if (!adToken) throw new Error('Токен не найден');

    await toggleFbCampaign(campaignId, status, adToken.token, adToken.proxyUrl);

    await prisma.fbCampaign.update({
      where: { campaignId },
      data: { status },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}