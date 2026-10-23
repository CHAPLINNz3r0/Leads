import { GoogleGenAI } from '@google/genai';

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

    const { messages, leads = [], targetPerDay = 10, defaultSalePrice = 100 } = JSON.parse(event.body || '{}');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const leadsSummary = leads.map((l: any, i: number) => ({
      index: i + 1,
      id: l.id,
      username: l.username,
      name: l.fullName || l.name,
      day: l.dayOfWeek || 'pool',
      status: l.status,
      linkType: l.linkType,
      category: l.category,
      priority: l.priority,
      saleValue: l.saleValue || defaultSalePrice || 100,
      daysSinceApproached: l.approachedAt
        ? Math.floor((Date.now() - new Date(l.approachedAt).getTime()) / (1000 * 60 * 60 * 24))
        : null,
      hasScreenshot: Boolean(l.screenshotUrl),
    }));

    const now = new Date();
    const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const currentDayName = dayNames[now.getDay()];
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    const systemInstruction = `Você é o Copilot de Operação e Prospecção do LeadRadar AI.
Você é um agente com poder REAL de alterar a base de dados de leads da aplicação.
Contexto temporal real:
- HOJE É: ${currentDayName} (${isWeekend ? 'FIM DE SEMANA - planejar para a semana útil começando na Segunda-feira' : 'Dia útil de prospecção'})
- Semana de prospecção comercial: EXCLUSIVAMENTE DE SEGUNDA A SEXTA (5 dias úteis).
- ATENÇÃO CRÍTICA: O Sábado foi TOTALMENTE REMOVIDO do sistema. NUNCA atribua 'sabado' a nenhum lead. Os dias válidos são apenas: "segunda", "terca", "quarta", "quinta", "sexta" ou "pool" (espera).
Configuração atual:
- Meta diária: ${targetPerDay} leads por dia (Segunda a Sexta)
- Preço padrão por página vendida: R$ ${defaultSalePrice}

LEADS ATUAIS NO SISTEMA:
${JSON.stringify(leadsSummary, null, 2)}

SUAS REGRAS DE AÇÃO:
Quando o usuário pedir para:
- Remover vendas ou resetar status de vendidos: você DEVE gerar um bloco \`\`\`action com "actionType": "update_leads" alterando os leads que estavam 'vendido' para 'nao_abordado' ou 'negociacao', com "saleValue": 0 e "closedAt": null!
- Distribuir leads da semana (ex: "distribui os leads", "organiza a semana"): você DEVE priorizar os dias mais próximos de Segunda a Sexta PREENCHENDO ATÉ LOTAR a meta de ${targetPerDay} leads por dia antes de passar para o dia seguinte (sem colocar nenhum lead no sábado!), gerando a nova alocação no bloco \`\`\`action!
- Mudar o valor de venda ou meta diária: gere a ação correspondente.

FORMATO OBRIGATÓRIO DE AÇÃO:
Sempre que fizer ou prometer qualquer alteração na base, inclua no final da sua resposta:
\`\`\`action
{
  "actionType": "update_leads",
  "description": "Texto curto explicando o que foi aplicado na tela",
  "updatedLeads": [
    {
      "id": "lead-id-aqui",
      "status": "nao_abordado",
      "dayOfWeek": "segunda",
      "saleValue": 0,
      "closedAt": null
    }
  ],
  "configUpdate": {
    "targetPerDay": 10,
    "defaultSalePrice": 100
  }
}
\`\`\`

Diga ao usuário em tom direto, profissional e em português exatamente o que você fez e mostre os resultados. Se ele pediu listas de leads, copie formatado pronto para envio.`;

    const contents = (messages || []).map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents,
      config: {
        systemInstruction,
        temperature: 0.5,
      },
    });

    const replyText = response.text || 'Processando resposta...';

    let executedAction: any = null;
    const actionMatch = replyText.match(/```action\s*([\s\S]*?)\s*```/);
    if (actionMatch && actionMatch[1]) {
      try {
        executedAction = JSON.parse(actionMatch[1]);
      } catch (e) {
        console.error('Falha ao parsear JSON da action:', e);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        reply: replyText.replace(/```action[\s\S]*?```/, '').trim(),
        executedAction,
      }),
    };
  } catch (error: any) {
    console.error('Erro no copilot no Netlify:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Erro ao conversar com o copiloto.',
        details: error?.message || String(error),
      }),
    };
  }
};
