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

    const { imageBase64, mimeType = 'image/jpeg' } = JSON.parse(event.body || '{}');
    if (!imageBase64) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Nenhuma imagem foi enviada.' }),
      };
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');

    const prompt = `Analise este print de perfil do Instagram e extraia minuciosamente os dados do lead para prospecção B2B.
Extraia:
- username: o @ do perfil (exemplo: @joaosilva ou joaosilva)
- fullName: o nome que aparece em destaque no perfil
- bio: o texto completo da bio
- linkType: qual o tipo de link na bio. Classifique estritamente como um destes: 'linktree' | 'wame' | 'website' | 'none' | 'other'
- linkUrl: o link exato ou texto do link visível na bio (se não houver, deixe vazio "")
- category: nicho ou profissão identificada
- followersApprox: contagem aproximada de seguidores se visível
- prospectingAngle: sugestão de 1 frase curta e certeira para abordar esse lead vendendo serviço de páginas/sites por R$ 100
- suggestedPriority: 'high', 'medium' ou 'low'

Responda em formato JSON.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: cleanBase64,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            username: { type: Type.STRING },
            fullName: { type: Type.STRING },
            bio: { type: Type.STRING },
            linkType: {
              type: Type.STRING,
              description: "Deve ser 'linktree', 'wame', 'website', 'none' ou 'other'",
            },
            linkUrl: { type: Type.STRING },
            category: { type: Type.STRING },
            followersApprox: { type: Type.STRING },
            prospectingAngle: { type: Type.STRING },
            suggestedPriority: {
              type: Type.STRING,
              description: "Deve ser 'high', 'medium' ou 'low'",
            },
          },
          required: ['username', 'fullName', 'bio', 'linkType', 'suggestedPriority'],
        },
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        leadData: {
          ...parsed,
          username: parsed.username
            ? parsed.username.startsWith('@')
              ? parsed.username
              : `@${parsed.username}`
            : '@lead',
        },
      }),
    };
  } catch (error: any) {
    console.error('Erro na análise de perfil no Netlify:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Não foi possível analisar o print do perfil.',
        details: error?.message || String(error),
      }),
    };
  }
};
