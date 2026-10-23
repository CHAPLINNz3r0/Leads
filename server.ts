import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '60mb' }));

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no ambiente.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// API: Análise de Raio-X do Print do Instagram (Multimodal Vision)
app.post('/api/analyze-profile', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });
    }

    const ai = getGeminiClient();
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');

    const prompt = `Analise este print de perfil do Instagram e extraia minuciosamente os dados do lead para prospecção B2B.
Extraia:
- username: o @ do perfil (exemplo: @joaosilva ou joaosilva)
- fullName: o nome que aparece em destaque no perfil
- bio: o texto completo da bio
- linkType: qual o tipo de link na bio. Classifique estritamente como um destes: 'linktree' | 'wame' | 'website' | 'none' | 'other' (ex: se tiver wa.me ou api.whatsapp -> 'wame'; se tiver linktr.ee, beacons, etc -> 'linktree'; se tiver site próprio/loja -> 'website'; se não tiver link -> 'none'; outros links -> 'other')
- linkUrl: o link exato ou texto do link visível na bio (se não houver, deixe vazio "")
- category: nicho ou profissão identificada (ex: "Odontologia", "Moda Feminina", "Advogado", "Nutricionista", "Barbearia", "Infoprodutor", "Restaurante", etc.)
- followersApprox: contagem aproximada de seguidores se visível (ex: "4.2k", "12k", "850", ou "")
- prospectingAngle: sugestão de 1 frase curta e certeira para abordar esse lead vendendo serviço de páginas/sites por R$ 100
- suggestedPriority: 'high' (se tiver wa.me, sem site próprio ou evidente interesse comercial), 'medium', ou 'low'

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

    return res.json({
      success: true,
      leadData: {
        ...parsed,
        username: parsed.username ? (parsed.username.startsWith('@') ? parsed.username : `@${parsed.username}`) : '@lead',
      },
    });
  } catch (error: any) {
    console.error('Erro na análise de perfil:', error);
    return res.status(500).json({
      error: 'Não foi possível analisar o print do perfil.',
      details: error?.message || String(error),
    });
  }
});

// API: Copilot Conversacional / Agente de Operação
app.post('/api/chat-copilot', async (req: Request, res: Response) => {
  try {
    const { messages, leads = [], targetPerDay = 10, defaultSalePrice = 100 } = req.body;
    const ai = getGeminiClient();

    // Sumarização dos leads para o contexto do prompt
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
      daysSinceApproached: l.approachedAt ? Math.floor((Date.now() - new Date(l.approachedAt).getTime()) / (1000 * 60 * 60 * 24)) : null,
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
- Distribuir leads da semana (ex: "distribui os leads", "organiza a semana"): você DEVE priorizar os dias mais próximos de Segunda a Sexta (se hoje for fim de semana, comece por segunda; se hoje for dia de semana, comece pelo dia de hoje e dias seguintes) PREENCHENDO ATÉ LOTAR a meta de ${targetPerDay} leads por dia antes de passar para o dia seguinte (sem colocar nenhum lead no sábado!), gerando a nova alocação no bloco \`\`\`action!
- Mudar o valor de venda ou meta diária: gere a ação correspondente.

FORMATO OBRIGATÓRIO DE AÇÃO:
Sempre que fizer ou prometer qualquer alteração na base, inclua no final da sua resposta:
\`\`\`action
{
  "actionType": "update_leads" | "distribute" | "update_config",
  "description": "Texto curto explicando o que foi aplicado na tela",
  "updatedLeads": [
    {
      "id": "lead-id-aqui",
      "status": "nao_abordado" | "abordado" | "follow_up" | "negociacao" | "vendido" | "perdido",
      "dayOfWeek": "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "pool",
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

    const contents = messages.map((m: any) => ({
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

    // Extrair action se houver
    let executedAction: any = null;
    const actionMatch = replyText.match(/```action\s*([\s\S]*?)\s*```/);
    if (actionMatch && actionMatch[1]) {
      try {
        executedAction = JSON.parse(actionMatch[1]);
      } catch (e) {
        console.error('Falha ao parsear JSON da action:', e);
      }
    }

    return res.json({
      success: true,
      reply: replyText.replace(/```action[\s\S]*?```/, '').trim(),
      executedAction,
    });
  } catch (error: any) {
    console.error('Erro no copilot:', error);
    return res.status(500).json({
      error: 'Erro ao conversar com o copiloto.',
      details: error?.message || String(error),
    });
  }
});

// API: Gerador de Pitch de Abordagem Personalizado
app.post('/api/generate-pitch', async (req: Request, res: Response) => {
  try {
    const { lead } = req.body;
    if (!lead) {
      return res.status(400).json({ error: 'Lead não informado.' });
    }

    const ai = getGeminiClient();
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
    return res.json({ success: true, pitches: parsed.pitches });
  } catch (error: any) {
    console.error('Erro ao gerar pitch:', error);
    return res.status(500).json({
      error: 'Erro ao gerar pitch.',
      details: error?.message || String(error),
    });
  }
});

// Banco de Dados Persistente em Arquivo (mantém dados mesmo ao atualizar a página)
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ leads: null, config: { targetPerDay: 10, defaultSalePrice: 100 } }, null, 2),
      'utf-8'
    );
  }
}

function readDatabase() {
  ensureDatabase();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erro ao ler database.json:', err);
    return { leads: null, config: { targetPerDay: 10, defaultSalePrice: 100 } };
  }
}

function writeDatabase(data: any) {
  ensureDatabase();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar database.json:', err);
  }
}

// API: Carregar banco de dados
app.get('/api/database', (_req: Request, res: Response) => {
  const dbData = readDatabase();
  return res.json({ success: true, ...dbData });
});

// API: Salvar banco de dados completo (leads e configurações)
app.post('/api/database', (req: Request, res: Response) => {
  try {
    const { leads, config } = req.body;
    const current = readDatabase();
    const updated = {
      leads: leads !== undefined ? leads : current.leads,
      config: config !== undefined ? { ...current.config, ...config } : current.config,
      updatedAt: new Date().toISOString(),
    };
    writeDatabase(updated);
    return res.json({ success: true, count: updated.leads ? updated.leads.length : 0 });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao salvar no banco de dados', details: err?.message });
  }
});

// Setup Vite middleware in dev or serve static in prod
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor LeadRadar AI rodando na porta ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
