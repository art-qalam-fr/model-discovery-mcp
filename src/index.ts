import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import fsSync from "node:fs";

const server = new McpServer(
  {
    name: "model-discovery",
    version: "1.0.0"
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

// Ressource pour lister les modèles gratuits disponibles (OpenRouter + Ollama local)
  server.resource(
    "Liste des modèles LLM gratuits disponibles en temps réel",
    "model://available/free",
    async () => {
      let allModels: any[] = [];

    // 1. Catalogue NVIDIA NIM compte 1 — priorité haute (clé NVIDIA_API_KEY)
    try {
      const nimBase = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
      const nimKey = process.env.NVIDIA_API_KEY;
      if (nimKey) {
        const nimResponse = await axios.get(`${nimBase}/models`, {
          timeout: 15000,
          headers: { Authorization: `Bearer ${nimKey}` }
        });
        const nimModels = (nimResponse.data.data || []).map((m: any) => ({
          id: `nim/${m.id}`,
          name: m.id,
          description: `NVIDIA NIM (compte 1)${m.owned_by ? ` (${m.owned_by})` : ""}`,
          context_length: 0,
          architecture: {
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "Unknown",
            instruct_type: null
          }
        }));
        allModels = [...allModels, ...nimModels];
      }
    } catch (nimError: any) {
      console.warn("Could not fetch NVIDIA NIM models:", nimError.message);
    }

    // 2. Catalogue NVIDIA NIM compte 2 — fallback du compte 1 (NVIDIA_API_KEY_2)
    try {
      const nimBase = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
      const nimKey2 = process.env.NVIDIA_API_KEY_2;
      if (nimKey2) {
        const nimResponse = await axios.get(`${nimBase}/models`, {
          timeout: 15000,
          headers: { Authorization: `Bearer ${nimKey2}` }
        });
        const nimModels = (nimResponse.data.data || []).map((m: any) => ({
          id: `nim2/${m.id}`,
          name: m.id,
          description: `NVIDIA NIM (compte 2)${m.owned_by ? ` (${m.owned_by})` : ""}`,
          context_length: 0,
          architecture: {
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "Unknown",
            instruct_type: null
          }
        }));
        allModels = [...allModels, ...nimModels];
      }
    } catch (nim2Error: any) {
      console.warn("Could not fetch NVIDIA NIM2 models:", nim2Error.message);
    }

    // 3. Ollama — modèles :cloud tagués ollama-cloud ; locaux réservés à l'utilisateur
    // /api/tags liste aussi les modèles :cloud -> peut prendre >30s
    try {
      const ollamaResponse = await axios.get("http://localhost:11434/api/tags", { timeout: 45000 });
      if (ollamaResponse.data && ollamaResponse.data.models) {
        const ollamaModels = ollamaResponse.data.models.map((model: any) => {
          const isCloud = model.name.endsWith(":cloud") || model.name.endsWith("-cloud");
          return {
            id: isCloud ? `ollama-cloud/${model.name}` : model.name,
            name: model.name,
            description: `${isCloud ? "Ollama Cloud" : "Local Ollama"} model${model.details?.family ? ` (${model.details.family})` : ""}${model.details?.parameter_size ? ` ${model.details.parameter_size}` : ""}`,
            context_length: 0,
            architecture: {
              modality: "text->text",
              input_modalities: ["text"],
              output_modalities: ["text"],
              tokenizer: model.details?.tokenizer || "Unknown",
              instruct_type: null
            }
          };
        });
        allModels = [...allModels, ...ollamaModels];
      }
    } catch (ollamaError: any) {
      // Ollama not available or error, continue with OpenRouter only
      console.warn("Could not fetch Ollama models:", ollamaError.message);
    }

    // 4. OpenRouter :free — supplément de dernier recours
    try {
      const openrouterResponse = await axios.get("https://openrouter.ai/api/v1/models", {
        timeout: 5000
      });

      const models = openrouterResponse.data.data || [];

      const freeModels = models
        .filter((model: any) =>
          !!model.pricing &&
          model.pricing.prompt === "0" &&
          model.pricing.completion === "0"
        )
        .map((model: any) => ({
          id: model.id,
          name: model.name || model.id,
          description: model.description || "",
          context_length: model.context_length || 0,
          architecture: model.architecture || {}
        }));

      allModels = [...allModels, ...freeModels];
    } catch (openrouterError: any) {
      console.warn("Could not fetch OpenRouter models:", openrouterError.message);
    }

    // 5. Catalogue HuggingFace router (cle en env utilisateur, OpenAI-compatible)
    try {
      const hfKey = process.env.HF_TOKEN;
      if (hfKey) {
        const hfResponse = await axios.get("https://router.huggingface.co/v1/models", {
          timeout: 15000,
          headers: { Authorization: `Bearer ${hfKey}` }
        });
        const hfModels = (hfResponse.data.data || []).map((m: any) => ({
          id: `hf/${m.id}`,
          name: m.id,
          description: "HuggingFace router",
          context_length: 0,
          architecture: {
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "Unknown",
            instruct_type: null
          }
        }));
        allModels = [...allModels, ...hfModels];
      }
    } catch (hfError: any) {
      console.warn("Could not fetch HuggingFace models:", hfError.message);
    }

    // Dédupliquer par id (au cas où un modèle apparaîtrait dans les deux sources)
    const uniqueModels = Array.from(new Map(allModels.map(model => [model.id, model])).values());

    // Limiter à 250 modèles au total pour éviter les réponses trop longues
    const limitedModels = uniqueModels.slice(0, 250);
    
    return {
      contents: [
        {
          uri: "model://available/free",
          mimeType: "application/json",
          text: JSON.stringify(limitedModels, null, 2)
        }
      ]
    };
  }
);

// Outil pour pinger un fournisseur spécifique et vérifier la disponibilité d'un modèle
server.tool(
  "ping-supplier",
  "Vérifie en temps réel la disponibilité d'un fournisseur (nim par défaut ; nim2 | ollama | ollama-cloud | openrouter | hf supportés)",
  {
    supplier: z.string().optional().describe("nim (defaut) | nim2 | ollama | ollama-cloud | openrouter | hf")
  },
  async (args: any, extra) => {
    const supplier = (args?.supplier || "nim").toLowerCase();
    try {
      if (supplier === "ollama" || supplier === "ollama-cloud") {
        const started = Date.now();
        const r = await axios.get("http://localhost:11434/api/tags", { timeout: 45000 });
        let models = (r.data?.models || []).map((m: any) => ({ id: m.name, name: m.name }));
        if (supplier === "ollama-cloud") {
          models = models.filter((m: any) => m.id.endsWith(":cloud") || m.id.endsWith("-cloud"));
        }
        return {
          content: [{ type: "text", text: JSON.stringify({
            supplier, available: true, latencyMs: Date.now() - started,
            modelCount: models.length, models: models.slice(0, 50),
            timestamp: new Date().toISOString() }, null, 2) }]
        };
      }
      if (supplier === "nim" || supplier === "nim2") {
        const nimBase = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
        const keyEnv = supplier === "nim2" ? "NVIDIA_API_KEY_2" : "NVIDIA_API_KEY";
        const nimKey = process.env[keyEnv];
        if (!nimKey) throw new Error(`${keyEnv} absente de l'env`);
        const started = Date.now();
        const r = await axios.get(`${nimBase}/models`, {
          timeout: 15000, headers: { Authorization: `Bearer ${nimKey}` }
        });
        const models = (r.data?.data || []).map((m: any) => ({ id: m.id, name: m.id }));
        return {
          content: [{ type: "text", text: JSON.stringify({
            supplier, available: true, latencyMs: Date.now() - started,
            modelCount: models.length, models: models.slice(0, 50),
            timestamp: new Date().toISOString() }, null, 2) }]
        };
      }
      if (supplier === "hf" || supplier === "huggingface") {
        const hfKey = process.env.HF_TOKEN;
        if (!hfKey) throw new Error("HF_TOKEN absent de l'env");
        const started = Date.now();
        const r = await axios.get("https://router.huggingface.co/v1/models", {
          timeout: 15000, headers: { Authorization: `Bearer ${hfKey}` }
        });
        const models = (r.data?.data || []).map((m: any) => ({ id: `hf/${m.id}`, name: m.id }));
        return {
          content: [{ type: "text", text: JSON.stringify({
            supplier: "hf", available: true, latencyMs: Date.now() - started,
            modelCount: models.length, models: models.slice(0, 50),
            timestamp: new Date().toISOString() }, null, 2) }]
        };
      }
      const response = await axios.get("https://openrouter.ai/api/v1/models", {
        timeout: 5000
      });

      const models = response.data.data || [];
      const freeModels = models
        .filter((model: any) =>
          !!model.pricing &&
          model.pricing.prompt === "0" &&
          model.pricing.completion === "0"
        )
        .slice(0, 10);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              supplier,
              available: true,
              modelCount: freeModels.length,
              models: freeModels.map((m: any) => ({
                id: m.id,
                name: m.name || m.id
              })),
              timestamp: new Date().toISOString()
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              available: false,
              error: String(error),
              timestamp: new Date().toISOString()
            }, null, 2)
          }
        ]
      };
    }
  }
);

// Ping d'inférence réel par modèle — POST /chat/completions max_tokens=1.
// Couvre toute la chaîne : nim|nim2 (NVIDIA), openrouter, kilo (gateway kilocode),
// nous (routeur free Hermes — token OAuth lu depuis auth.json), ollama (local).
// C'est la mesure qui alimente model_health : le catalogue ping-supplier prouve
// que le fournisseur répond, ping-model prouve que LE MODÈLE infère.
const MODEL_PING_ENDPOINTS: Record<string, () => { url: string; key?: string } | { error: string }> = {
  nim: () => ({ url: `${process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"}/chat/completions`, key: process.env.NVIDIA_API_KEY }),
  nim2: () => ({ url: `${process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"}/chat/completions`, key: process.env.NVIDIA_API_KEY_2 }),
  openrouter: () => ({ url: "https://openrouter.ai/api/v1/chat/completions", key: process.env.OPENROUTER_API_KEY }),
  "openrouter-free": () => ({ url: "https://openrouter.ai/api/v1/chat/completions", key: process.env.OPENROUTER_API_KEY }),
  kilo: () => ({ url: "https://api.kilo.ai/api/gateway/chat/completions", key: process.env.KILO_API_KEY }),
  nous: () => {
    try {
      const p = `${process.env.LOCALAPPDATA || ""}/hermes/auth.json`;
      const auth = JSON.parse(fsSync.readFileSync(p, "utf-8"));
      const tok = auth?.providers?.nous?.access_token;
      if (!tok) return { error: "nous access_token absent de hermes/auth.json" };
      return { url: "https://inference-api.nousresearch.com/v1/chat/completions", key: tok };
    } catch (e: any) { return { error: `nous auth: ${e.message}` }; }
  },
  ollama: () => ({ url: "http://localhost:11434/v1/chat/completions" }),
};

server.tool(
  "ping-model",
  "Ping d'inférence réel sur un modèle précis (max_tokens=1) — latence + disponibilité. supplier: nim|nim2|openrouter|kilo|nous|ollama",
  {
    supplier: z.string().describe("nim | nim2 | openrouter | kilo | nous | ollama"),
    model: z.string().describe("model_id exact envoyé à l'API (ex: nvidia/nemotron-3-super-120b-a12b)"),
    timeout_ms: z.number().optional().describe("timeout en ms (défaut 20000)")
  },
  async (args: any) => {
    const supplier = String(args.supplier || "").toLowerCase();
    const model = String(args.model || "");
    const timeout = args.timeout_ms || 20000;
    const resolver = MODEL_PING_ENDPOINTS[supplier];
    if (!resolver) {
      return { content: [{ type: "text", text: JSON.stringify({ available: false, error: `supplier inconnu: ${supplier}` }) }] };
    }
    const ep = resolver();
    if ("error" in ep) {
      return { content: [{ type: "text", text: JSON.stringify({ supplier, model, available: false, error: ep.error, timestamp: new Date().toISOString() }) }] };
    }
    const started = Date.now();
    try {
      const r = await axios.post(ep.url, {
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      }, {
        timeout,
        headers: {
          "Content-Type": "application/json",
          ...(ep.key ? { Authorization: `Bearer ${ep.key}` } : {})
        },
        validateStatus: () => true
      });
      const latencyMs = Date.now() - started;
      const ok = r.status >= 200 && r.status < 300;
      const errBody = ok ? undefined : (typeof r.data === "object" ? JSON.stringify(r.data).slice(0, 300) : String(r.data).slice(0, 300));
      return { content: [{ type: "text", text: JSON.stringify({
        supplier, model, available: ok, status: r.status, latencyMs,
        error: errBody, timestamp: new Date().toISOString()
      }, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({
        supplier, model, available: false, latencyMs: Date.now() - started,
        error: e.code === "ECONNABORTED" ? `timeout ${timeout}ms` : String(e.message || e),
        timestamp: new Date().toISOString()
      }) }] };
    }
  }
);

// Démarrage du serveur
async function main() {
  const transport = process.argv[2] === "stdio" 
    ? new StdioServerTransport()
    : new StreamableHTTPServerTransport({
        sessionIdGenerator: () => Math.random().toString(36).substr(2, 9)
      });
  
  await server.connect(transport);
  console.error("Model Discovery MCP Server running on stdio");
}

main().catch(error => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});