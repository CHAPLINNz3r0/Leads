import { GoogleGenAI, Type } from '@google/genai';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'GEMINI_API_KEY não configurada no Netlify.' }),
      };
    }

    const { lead } = JSON.parse(event.body || '{}');
    if (!lead) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Lead não informado.' }),
      };
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const prompt = `Crie 3 opções de mensagens curtas e naturais de Direct do Instagram para abordar o lead abaixo:
Nome: ${lead.fullName || 'Empresário(a)'}
Username: ${lead.username}
Bio: ${lead.bio || 'Sem bio'}
Link: ${lead.linkType} (${lead.linkUrl || 'nenhum'})
Nicho: ${lead.category || 'Geral'}

Objetivo: Oferecer a criação/otimização de uma página profissional ou bio link de alta conversão por R$ 100.
Estilos:
1. Curto e direto (sem enrolação, tom amigável)
2. Elogio genuíno ao trabalho + Apontar oportunidade de vendas com página
3. Oferta irresistível direta com garantia

Retorne apenas um JSON com um array de strings "pitches".`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pitches: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['pitches'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{"pitches":[]}');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, pitches: parsed.pitches }),
    };
  } catch (error: any) {
    console.error('Erro ao gerar pitch no Netlify:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Erro ao gerar pitch.',
        details: error?.message || String(error),
      }),
    };
  }
};
